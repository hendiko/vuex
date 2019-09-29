import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    // 如果在全局作用域下发现未加载 vuex 的 Vue 构造函数，则自动加载 vuex 插件，
    // 以此避免多次加载本插件。
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(
        typeof Promise !== 'undefined',
        `vuex requires a Promise polyfill in this browser.`
      )
      assert(
        this instanceof Store,
        `store must be called with the new operator.`
      )
    }

    const { plugins = [], strict = false } = options

    // store internal state
    this._committing = false
    // Object.create(null) 没有原型，纯 Object
    this._actions = Object.create(null)
    this._actionSubscribers = []
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)

    //  this._modules 是一个 ModuleCollection 实例，是因为 this._moduleCollection 太长了吗？
    this._modules = new ModuleCollection(options)
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    // 为什么要覆盖原型方法？
    // 因为 dispatch 和 commit 会作为第一公民到处传递，
    // 这里是确保无论他们被传递到哪里进行调用，闭包内的 dispatch 和 commit 上下文都是 store
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    // 从根 module 开始，初始化所有静态 module，构建所有的 state, getters, mutations, actions
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // 这里才真正初始设置 state 为 Vue 的可观察对象。
    // Observable 的 state 位于 this._vm._data.$$state
    resetStoreVM(this, state)

    // apply plugins
    // 应用插件
    plugins.forEach(plugin => plugin(this))

    const useDevtools =
      options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  // 获取整个 store 的 state
  get state () {
    return this._vm._data.$$state
  }

  // 无效设置方法，因为 vuex 希望使用 store.replaceState() 方法来设置
  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  /**
   * 这里使用下划线开头命名参数，是为了在函数体内可以不使用下划线开头
   */
  commit (_type, _payload, _options) {
    // check object-style commit
    const { type, payload, options } = unifyObjectStyle(
      _type,
      _payload,
      _options
    )

    const mutation = { type, payload }
    const entry = this._mutations[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }

    // 开始调用 mutations 数组里的每个 handle 对 state 进行修改。
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    // 如果开发者调用过 store.subscribe(), 那么这里的 sub 在一次 commit 结束之后都会调用一次。
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (process.env.NODE_ENV !== 'production' && options && options.silent) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
          'Use the filter functionality in the vue-devtools'
      )
    }
  }

  /** dispatch 的实现 */
  dispatch (_type, _payload) {
    // check object-style dispatch
    const { type, payload } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    // 处理如果调用过 store.subscribeAction() 方法。
    try {
      this._actionSubscribers
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    // 每个 handle 返回的都是 promise
    const result =
      entry.length > 1
        ? Promise.all(entry.map(handler => handler(payload)))
        : entry[0](payload)

    return result.then(res => {
      // 处理 store.subscribeAction() 产生的订阅队列
      try {
        this._actionSubscribers
          .filter(sub => sub.after)
          .forEach(sub => sub.after(action, this.state))
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[vuex] error in after action subscribers: `)
          console.error(e)
        }
      }
      return res
    })
  }

  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  subscribeAction (fn) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers)
  }

  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(
        typeof getter === 'function',
        `store.watch only accepts a function.`
      )
    }
    return this._watcherVM.$watch(
      () => getter(this.state, this.getters),
      cb,
      options
    )
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  /** 动态注册模块 */
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(
        path.length > 0,
        'cannot register the root module by using registerModule.'
      )
    }

    // 在 moduleCollection 中保存下 module 信息
    this._modules.register(path, rawModule)

    installModule(
      this,
      this.state,
      path,
      this._modules.get(path),
      options.preserveState
    )
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  /**
   * 该方法的存在是为了观察每一个 mutation 操作是处于内部规定的流程中
   * 防止开发者擅自对 store 内部 state 进行修改。
   */
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

// 重置 store
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// 重置 store._vm
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure enviroment.
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  // 此处使用 $$state 是为了在 _vm 对象上隐藏 $$state,
  // $$state 只能通过 _vm._data.$$state  访问到，并且它是一个 Observable 对象。
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

/**
 * 将模块组装到 Store 实例上。
 * @param {object}} store 数据仓库
 * @param {object}} rootState 根state
 * @param {string} path 模块路径
 * @param {object} module 模块
 * @param {boolean} hot 是否支持热插
 */
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  if (module.namespaced) {
    if (
      store._modulesNamespaceMap[namespace] &&
      process.env.NODE_ENV !== 'production'
    ) {
      console.error(
        `[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join(
          '/'
        )}`
      )
    }
    // 如果启用了命名空间，则通过命名空间缓存模块
    store._modulesNamespaceMap[namespace] = module
  }

  // 只有非 root 和 hot 的模块 state 才会通过下面逻辑分支设置
  // root module 的 state 在 store 构造函数中通过 resetStoreVM() 实现
  // set state
  if (!isRoot && !hot) {
    // 返回嵌套 Module 的 state
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }

  const local = (module.context = makeLocalContext(store, namespace, path))

  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 *
 * 返回：{dispatch, commit, state, getters}
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    // 如果没有命名空间，直接就返回 dispatch 函数
    // 否则返回一个高阶函数封装了 dispatch，高阶函数会自动拼接命名空间和类型(namespace+type)
    dispatch: noNamespace
      ? store.dispatch
      : (_type, _payload, _options) => {
        const args = unifyObjectStyle(_type, _payload, _options)
        const { payload, options } = args
        let { type } = args

        if (!options || !options.root) {
          type = namespace + type
          if (
            process.env.NODE_ENV !== 'production' &&
              !store._actions[type]
          ) {
            console.error(
              `[vuex] unknown local action type: ${
                args.type
              }, global type: ${type}`
            )
            return
          }
        }

        return store.dispatch(type, payload)
      },

    // 参见上面 dispatch 注释
    commit: noNamespace
      ? store.commit
      : (_type, _payload, _options) => {
        const args = unifyObjectStyle(_type, _payload, _options)
        const { payload, options } = args
        let { type } = args

        if (!options || !options.root) {
          type = namespace + type
          if (
            process.env.NODE_ENV !== 'production' &&
              !store._mutations[type]
          ) {
            console.error(
              `[vuex] unknown local mutation type: ${
                args.type
              }, global type: ${type}`
            )
            return
          }
        }

        store.commit(type, payload, options)
      }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}

/**
 * handler 就是定义的 mutation 函数
 * mutation 函数上下文是当前 store 实例，接受参数 `(module.state, payload)`
 */
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  // 封装 handler 函数
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}

/**
 * handler 是定义的 action 函数
 * action 函数上下文为 store 实例，参数 `({dispatch, commit, getters, state, rootGetters, rootState}, payload, cb)`
 */
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  // 这里居然有一个 cb 参数？
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler.call(
      store,
      {
        dispatch: local.dispatch,
        commit: local.commit,
        getters: local.getters,
        state: local.state,
        rootGetters: store.getters,
        rootState: store.state
      },
      payload,
      cb
    )
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      // dispatch 返回一个 Promise
      return res
    }
  })
}

function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }

  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

function enableStrictMode (store) {
  store._vm.$watch(
    function () {
      return this._data.$$state
    },
    () => {
      if (process.env.NODE_ENV !== 'production') {
        assert(
          store._committing,
          `do not mutate vuex store state outside mutation handlers.`
        )
      }
    },
    { deep: true, sync: true }
  )
}

function getNestedState (state, path) {
  return path.length ? path.reduce((state, key) => state[key], state) : state
}

/**
 * 标准化参数形式为 {type, payload, options}
 * 如果同时指定 type 和 payload.type，以前者作为真正的 type。
 */
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(
      typeof type === 'string',
      `expects string as the type, but found ${typeof type}.`
    )
  }

  return { type, payload, options }
}

/**
 * 根据 Vue 的插件规则，必须使用 Vue.use(plugin, options) 来调用插件。
 * 而 plugin 必须是一个对象，其中应包含一个 install 方法。
 * 该 install 方法第一个参数将传入 Vue 构造函数。
 */
export function install (_Vue) {
  // 防止二次注册（但 Vue.use 自身已经有防止重复注册的机制）
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  // 将局部变量 Vue 赋值 vue 的构造函数，用来标识是否已经完成了 store 构造与注册，以免重复注册。
  Vue = _Vue
  // 主要是确保在每个 Vue 实例中注入 $store 对象
  applyMixin(Vue)
}
