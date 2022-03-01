import { forEachValue } from '../util'

// 根据传进构造函数的配置生成一个新的module，
// 主要属性：1._children，2._rowModule，3.state
export default class Module {
    constructor(rawModule, runtime) {
        this.runtime = runtime
        this._children = Object.create(null)
        this._rawModule = rawModule
        const rawState = rawModule.state

        this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
    }
    // 查看是否是命名空间的module
    get namespaced() {
        return !!this._rawModule.namespaced
    }

    // 添加子module
    addChild(key, module) {
        this._children[key] = module
    }

    // 删除子module
    removeChild(key) {
        delete this._children[key]
    }

    // 根据key获取module
    getChild(key) {
        return this._children[key]
    }

    // 查询是否有该key的子module
    hasChild(key) {
        return key in this._children
    }

    // 更新module，替换源module上的除state外的配置
    update(rawModule) {
        this._rawModule.namespaced = rawModule.namespaced
        if (rawModule.actions) {
            this._rawModule.actions = rawModule.actions
        }
        if (rawModule.mutations) {
            this._rawModule.mutations = rawModule.mutations
        }
        if (rawModule.getters) {
            this._rawModule.getters = rawModule.getters
        }
    }
    // 将子模块进行遍历，fn接收模块的key和对应的module
    forEachChild(fn) {
        forEachValue(this._children, fn)
    }

    forEachGetter(fn) {
        if (this._rawModule.getters) {
            forEachValue(this._rawModule.getters, fn)
        }
    }

    forEachAction(fn) {
        if (this._rawModule.actions) {
            forEachValue(this._rawModule.actions, fn)
        }
    }

    forEachMutation(fn) {
        if (this._rawModule.mutations) {
            forEachValue(this._rawModule.mutations, fn)
        }
    }
}
