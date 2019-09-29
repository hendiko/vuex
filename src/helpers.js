/**
 * mapHelper 函数与 vuex 没有必要联系，只是为了方便使用。
 * 核心还是 store 对象的结构，知道结构以后就可以自己另写 mapHelper 函数。
 */

/**
 * Reduce the code which written in Vue.js for getting the state.
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} states # Object's item can be a function which accept state and getters for param, you can do something for state and getters in it.
 * @param {Object}
 *
 * xavier:
 * mapState 函数签名有两种：
 *  - mapState(states:object)
 *  - mapState(namespace:string, states:object)
 */
export const mapState = normalizeNamespace((namespace, states) => {
  const res = {}
  // xavier:
  // 标准化 states 格式为 `[{key, val}]`
  normalizeMap(states).forEach(({ key, val }) => {
    // memo:这里使用匿名函数也没有关系吧，使用命名函数只是为了帮助阅读代码？
    res[key] = function mappedState () {
      let state = this.$store.state
      let getters = this.$store.getters
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapState', namespace)
        if (!module) {
          // ～没有找到命名空间对应的模块，直接返回 undefined。
          return
        }
        state = module.context.state
        getters = module.context.getters
      }
      // 按照用法，mapState() 返回值会被合并到 vue 实例的 computed 属性中。
      // 因此本函数会作为 computed 计算属性的计算函数被记录在 vue 实例的 computed 属性中。
      // 如果 val 是函数，则立即计算该函数返回值作为计算属性值，val 函数的上下文指向 vue 实例。
      // 否则的话，直接返回 state[val]，而 state 可能是来自 store.state，或者模块的 module.context.state
      // 如果 mapState({foo(state, getters) {}})
      // state 函数将接收 (state, getters)
      return typeof val === 'function'
        ? val.call(this, state, getters)
        : state[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for committing the mutation
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} mutations # Object's item can be a function which accept `commit` function as the first param, it can accept anthor params. You can commit mutation and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */
export const mapMutations = normalizeNamespace((namespace, mutations) => {
  const res = {}
  normalizeMap(mutations).forEach(({ key, val }) => {
    // map 后的 mutation 函数是可以接收额外参数作为 payload 的。
    // 如果 map 的是一个 string，那么这个 string 就是 mutation-type，即 mutation 的方法名。
    // 通过 commit 触发 mutation，而 mappedMutation 函数可以传入一个参数作为 payload
    // 如果 map 的是一个 function，那么这个 function 签名为 `function(commit, args)`，上下文指向当前 vue 实例。
    // （官方文档并未提及 map 一个函数，虽然这个特性是后来加入，但也是两年前就已经加入了，不知道为什么官方并不说明该api）。
    res[key] = function mappedMutation (...args) {
      // Get the commit method from store
      let commit = this.$store.commit
      if (namespace) {
        const module = getModuleByNamespace(
          this.$store,
          'mapMutations',
          namespace
        )
        if (!module) {
          return
        }
        commit = module.context.commit
      }

      // 如果是 function，意味着 mappedMutation 函数可以接收 `(mutationType, payload)` 或 `(payload)`。
      // 否则，mappedMutation 函数只能接收 `(payload)` 无法动态指定 mutationType。
      return typeof val === 'function'
        ? val.apply(this, [commit].concat(args))
        : commit.apply(this.$store, [val].concat(args))
    }
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for getting the getters
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} getters
 * @return {Object}
 *
 * mapGetters(namespace:string, getters:array|object)
 * mapGetters(getters:array|object)
 */
export const mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  normalizeMap(getters).forEach(({ key, val }) => {
    // The namespace has been mutated by normalizeNamespace
    val = namespace + val
    res[key] = function mappedGetter () {
      if (
        namespace &&
        !getModuleByNamespace(this.$store, 'mapGetters', namespace)
      ) {
        // 如果没找到指定命名空间对应的模块，直接返回 undefined。
        return
      }
      if (
        process.env.NODE_ENV !== 'production' &&
        !(val in this.$store.getters)
      ) {
        // 开发模式下输出没有找到对应 getter 的错误信息。
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      // 返回 getter
      // 所有的 getter 会被存储在 $store.getters 中。
      // 为什么不用担心命名空间或内嵌模块的 getters 重名问题？
      // 因为 getter 定义时必须符合函数命名规则，即不含 `/` 符号，
      // 而内嵌模块或使用命名空间的时候，getters 会使用 `/` 进行分隔。
      return this.$store.getters[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for dispatch the action
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} actions # Object's item can be a function which accept `dispatch` function as the first param, it can accept anthor params. You can dispatch action and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 *
 * 基本和 mapMutations 相同，只是使用 dispatch 代替了 commit 作为映射函数的第一个参数。
 */
export const mapActions = normalizeNamespace((namespace, actions) => {
  const res = {}
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction (...args) {
      // get dispatch function from store
      let dispatch = this.$store.dispatch
      if (namespace) {
        const module = getModuleByNamespace(
          this.$store,
          'mapActions',
          namespace
        )
        if (!module) {
          return
        }
        dispatch = module.context.dispatch
      }
      return typeof val === 'function'
        ? val.apply(this, [dispatch].concat(args))
        : dispatch.apply(this.$store, [val].concat(args))
    }
  })
  return res
})

/**
 * Rebinding namespace param for mapXXX function in special scoped, and return them by simple object
 * @param {String} namespace
 * @return {Object}
 *
 * 只是预先绑定 helper 函数的第一个参数而已。
 */
export const createNamespacedHelpers = namespace => ({
  mapState: mapState.bind(null, namespace),
  mapGetters: mapGetters.bind(null, namespace),
  mapMutations: mapMutations.bind(null, namespace),
  mapActions: mapActions.bind(null, namespace)
})

/**
 * Normalize the map
 * normalizeMap([1, 2, 3]) => [ { key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 } ]
 * normalizeMap({a: 1, b: 2, c: 3}) => [ { key: 'a', val: 1 }, { key: 'b', val: 2 }, { key: 'c', val: 3 } ]
 * @param {Array|Object} map
 * @return {Object}
 *
 * xavier:
 * 标准化 map 传参，统一形式为 [{key: string, val: any}]
 */
function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}

/**
 * Return a function expect two param contains namespace and map. it will normalize the namespace and then the param's function will handle the new namespace and the map.
 * @param {Function} fn
 * @return {Function}
 *
 * xavier:
 * 标准化 map-helper 函数的传参，确保 (namespace:string, map:object) 参数形式。
 */
function normalizeNamespace (fn) {
  return (namespace, map) => {
    if (typeof namespace !== 'string') {
      map = namespace
      namespace = ''
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/'
    }
    return fn(namespace, map)
  }
}

/**
 * Search a special module from store by namespace. if module not exist, print error message.
 * @param {Object} store
 * @param {String} helper
 * @param {String} namespace
 * @return {Object}
 *
 * memo:
 * helper - helper 函数的名称，例如 `mapState`。
 * namespace - 命名空间名称。
 */
function getModuleByNamespace (store, helper, namespace) {
  // memo: 原来 store 中专门使用了一个属性用来保存所有的命名空间的name与module映射关系
  const module = store._modulesNamespaceMap[namespace]
  if (process.env.NODE_ENV !== 'production' && !module) {
    console.error(
      `[vuex] module namespace not found in ${helper}(): ${namespace}`
    )
  }
  return module
}
