/**
 *
 * @param {function} Vue vue 的构造函数
 */
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  // 根据 Vue 的版本进行混入
  if (version >= 2) {
    // 全局混入 beforeCreate 钩子
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init ? [vuexInit].concat(options.init) : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  function vuexInit () {
    // vuexInit 函数混入到 vue 实例钩子中，
    // 因此 this 指向 vue 实例。
    const options = this.$options
    // store injection
    if (options.store) {
      // 本分支代码表示在根 vue 实例注入 $store
      this.$store =
        typeof options.store === 'function' ? options.store() : options.store
    } else if (options.parent && options.parent.$store) {
      // 表示在子实例中注入 $store
      this.$store = options.parent.$store
    }
  }
}
