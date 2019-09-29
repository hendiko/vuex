import Module from './module'
import { assert, forEachValue } from '../util'

/**
 * 模块集合
 */
export default class ModuleCollection {
  // rawRootModule 是 Store 构造实例的 options
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false)
  }

  // 根据模块路径，从根模块开始寻找对应的模块
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // 获取指定路径模块的命名空间
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      // 就是简单地将所有显式的命名空间拼接起来，由于未检查 key 中是否包含 '/'，
      // 所以还是有命名冲突的可能。
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  /** 置换根 module */
  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  /**
   * 注册模块
   * @param {array} path 模块路径(数组形式保存)
   * @param {object} rawModule 作为 module 的配置
   * @param {boolean}} runtime 标识注册模块时，vuex 是否处于运行状态
   *
   * runtime 说人话就是标识注册模块的时候，store 是否完成了实例化。
   * 因为 store 实例化过程中会注册根模块，只有此时 runtime 为 false。
   *
   * 本方法是一个内部方法，并不作为公开api暴露给用户，用户只能通过
   * store.registerModule(path, rawModule) 来注册模块
   */
  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)

    // 不是根据 runtime 来判断是否是根模块。runtime 是表示首次初始化（根模块带着其他模块）
    // 而是通过 path 路径来判断是否是根模块。
    if (path.length === 0) {
      this.root = newModule
    } else {
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // 每次都要从根module开始添加，有点浪费啊
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  /** 注销指定路径的 module */
  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    // 静态模块不允许卸载
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}

function update (path, targetModule, newModule) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
              'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

const objectAssert = {
  assert: value =>
    typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
