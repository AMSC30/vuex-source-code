import applyMixin from './mixin'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue

// 实例对象的描述
export class Store {
    constructor(options = {}) {
        // cdn直接引用的方式，不用通过vue.use的方式，实例化时自动install
        if (!Vue && typeof window !== 'undefined' && window.Vue) {
            install(window.Vue)
        }

        if (__DEV__) {
            // 面试题： vuex自己定义了告警，为啥不用console.assert? - throw Error
            assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
            assert(
                typeof Promise !== 'undefined',
                `vuex requires a Promise polyfill in this browser.`
            )
            // 必须要用new操作符调用Store
            assert(this instanceof Store, `store must be called with the new operator.`)
        }

        // 参数初始化
        const { plugins = [], strict = false } = options

        // store internal state
        this._committing = false

        // 用于缓存模块，key为命名空间，值为包装后的module
        this._modulesNamespaceMap = Object.create(null)
        this._actions = Object.create(null)
        this._mutations = Object.create(null)

        // 模块管理器，通过store的_modules进行管理
        this._modules = new ModuleCollection(options)

        // 订阅器
        this._actionSubscribers = []
        this._subscribers = []

        // vue实例
        this._watcherVM = new Vue()
        this._wrappedGetters = Object.create(null)
        this._makeLocalGettersCache = Object.create(null)

        //  重写，保证方法调用的时候this指向store
        const store = this
        const { dispatch, commit } = this
        this.dispatch = function boundDispatch(type, payload) {
            return dispatch.call(store, type, payload)
        }
        this.commit = function boundCommit(type, payload, options) {
            return commit.call(store, type, payload, options)
        }

        this.strict = strict

        const state = this._modules.root.state

        // 模块安装
        installModule(this, state, [], this._modules.root)

        // 对state做响应式处理，处理getter
        resetStoreVM(this, state)

        // 实例化完成后调用插件，将store作为参数传入
        plugins.forEach(plugin => plugin(this))
    }

    get state() {
        return this._vm._data.$$state
    }
    // 拦截
    set state(v) {
        if (__DEV__) {
            assert(false, `use store.replaceState() to explicit replace store state.`)
        }
    }

    commit(_type, _payload, _options) {
        const { type, payload, options } = unifyObjectStyle(_type, _payload, _options)

        const mutation = { type, payload }
        const entry = this._mutations[type]
        if (!entry) {
            if (__DEV__) {
                console.error(`[vuex] unknown mutation type: ${type}`)
            }
            return
        }
        this._withCommit(() => {
            entry.forEach(function commitIterator(handler) {
                handler(payload)
            })
        })

        this._subscribers.slice().forEach(sub => sub(mutation, this.state))
    }

    dispatch(_type, _payload) {
        // check object-style dispatch
        const { type, payload } = unifyObjectStyle(_type, _payload)

        const action = { type, payload }
        const entry = this._actions[type]
        if (!entry) {
            if (__DEV__) {
                console.error(`[vuex] unknown action type: ${type}`)
            }
            return
        }

        try {
            this._actionSubscribers
                .slice()
                .filter(sub => sub.before)
                .forEach(sub => sub.before(action, this.state))
        } catch (e) {
            if (__DEV__) {
                console.warn(`[vuex] error in before action subscribers: `)
                console.error(e)
            }
        }

        const result =
            entry.length > 1
                ? Promise.all(entry.map(handler => handler(payload)))
                : entry[0](payload)

        return new Promise((resolve, reject) => {
            result.then(
                res => {
                    try {
                        this._actionSubscribers
                            .filter(sub => sub.after)
                            .forEach(sub => sub.after(action, this.state))
                    } catch (e) {
                        if (__DEV__) {
                            console.warn(`[vuex] error in after action subscribers: `)
                            console.error(e)
                        }
                    }
                    resolve(res)
                },
                error => {
                    try {
                        this._actionSubscribers
                            .filter(sub => sub.error)
                            .forEach(sub => sub.error(action, this.state, error))
                    } catch (e) {
                        if (__DEV__) {
                            console.warn(`[vuex] error in error action subscribers: `)
                            console.error(e)
                        }
                    }
                    reject(error)
                }
            )
        })
    }

    subscribe(fn, options) {
        return genericSubscribe(fn, this._subscribers, options)
    }

    subscribeAction(fn, options) {
        const subs = typeof fn === 'function' ? { before: fn } : fn
        return genericSubscribe(subs, this._actionSubscribers, options)
    }

    watch(getter, cb, options) {
        if (__DEV__) {
            assert(typeof getter === 'function', `store.watch only accepts a function.`)
        }
        return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
    }

    replaceState(state) {
        this._withCommit(() => {
            this._vm._data.$$state = state
        })
    }

    registerModule(path, rawModule, options = {}) {
        if (typeof path === 'string') path = [path]

        if (__DEV__) {
            assert(Array.isArray(path), `module path must be a string or an Array.`)
            assert(path.length > 0, 'cannot register the root module by using registerModule.')
        }

        this._modules.register(path, rawModule)
        installModule(this, this.state, path, this._modules.get(path), options.preserveState)
        resetStoreVM(this, this.state)
    }

    unregisterModule(path) {
        if (typeof path === 'string') path = [path]

        if (__DEV__) {
            assert(Array.isArray(path), `module path must be a string or an Array.`)
        }

        this._modules.unregister(path)
        this._withCommit(() => {
            const parentState = getNestedState(this.state, path.slice(0, -1))
            Vue.delete(parentState, path[path.length - 1])
        })
        resetStore(this)
    }

    hasModule(path) {
        if (typeof path === 'string') path = [path]

        if (__DEV__) {
            assert(Array.isArray(path), `module path must be a string or an Array.`)
        }

        return this._modules.isRegistered(path)
    }

    hotUpdate(newOptions) {
        this._modules.update(newOptions)
        resetStore(this, true)
    }

    _withCommit(fn) {
        const committing = this._committing
        this._committing = true
        fn()
        this._committing = committing
    }
}

function genericSubscribe(fn, subs, options) {
    if (subs.indexOf(fn) < 0) {
        options && options.prepend ? subs.unshift(fn) : subs.push(fn)
    }
    return () => {
        const i = subs.indexOf(fn)
        if (i > -1) {
            subs.splice(i, 1)
        }
    }
}

function resetStore(store, hot) {
    store._actions = Object.create(null)
    store._mutations = Object.create(null)
    store._wrappedGetters = Object.create(null)
    store._modulesNamespaceMap = Object.create(null)
    const state = store.state
    installModule(store, state, [], store._modules.root, true)
    resetStoreVM(store, state, hot)
}

function resetStoreVM(store, state, hot) {
    const oldVm = store._vm

    store.getters = {}
    store._makeLocalGettersCache = Object.create(null)
    const wrappedGetters = store._wrappedGetters
    const computed = {}

    // 面试高频出现
    forEachValue(wrappedGetters, (fn, key) => {
        computed[key] = partial(fn, store)
        // 遍历地将所有getters桥接上store，并配置成computed属性
        Object.defineProperty(store.getters, key, {
            get: () => store._vm[key],
            enumerable: true // for local getters
        })
    })

    // 利用vue的能力，做响应式
    store._vm = new Vue({
        data: {
            $$state: state
        },
        computed
    })

    // 销毁
    if (oldVm) {
        if (hot) {
            store._withCommit(() => {
                oldVm._data.$$state = null
            })
        }
        Vue.nextTick(() => oldVm.$destroy())
    }
}

function installModule(store, rootState, path, module, hot) {
    // 判断是不是根模块
    const isRoot = !path.length

    // 从层级路径获取命名空间路径字符串,可能是空
    const namespace = store._modules.getNamespace(path)

    // 1.将有命名空间的模块缓存起来
    // 为什么要将其缓存起来，在helper中使用
    if (module.namespaced) {
        store._modulesNamespaceMap[namespace] = module
    }

    // 2.处理state，对module中的state做响应式处理并根据模块结构生成state树
    if (!isRoot && !hot) {
        const parentState = getNestedState(rootState, path.slice(0, -1))
        const moduleName = path[path.length - 1]
        store._withCommit(() => {
            // 所以可以通过store.state.user.a进行访问
            Vue.set(parentState, moduleName, module.state)
        })
    }

    // 3.生成模块本地store，相当于对应用store的代理
    const local = (module.context = makeLocalContext(store, namespace, path))

    // 4.处理mutation， 将所有的mutation注册到store的_mutations上面
    module.forEachMutation((mutation, key) => {
        const namespacedType = namespace + key
        registerMutation(store, namespacedType, mutation, local)
    })

    // 5.处理action 将所有的action注册到store的_actions上面
    module.forEachAction((action, key) => {
        // action:{
        // a:{
        // root:true,
        // handler:()=>{}}
        //  }这种写法
        const type = action.root ? key : namespace + key
        const handler = action.handler || action
        registerAction(store, type, handler, local)
    })

    // 6.处理getter
    module.forEachGetter((getter, key) => {
        const namespacedType = namespace + key
        registerGetter(store, namespacedType, getter, local)
    })

    // 7.递归子模块
    module.forEachChild((child, key) => {
        installModule(store, rootState, path.concat(key), child, hot)
    })
}

function makeLocalContext(store, namespace, path) {
    const noNamespace = namespace === ''

    const local = {
        dispatch: noNamespace
            ? store.dispatch
            : (_type, _payload, _options) => {
                  // 参数序列化
                  const args = unifyObjectStyle(_type, _payload, _options)
                  const { payload, options } = args
                  let { type } = args

                  if (!options || !options.root) {
                      type = namespace + type
                      if (__DEV__ && !store._actions[type]) {
                          console.error(
                              `[vuex] unknown local action type: ${args.type}, global type: ${type}`
                          )
                          return
                      }
                  }

                  return store.dispatch(type, payload)
              },

        commit: noNamespace
            ? store.commit
            : (_type, _payload, _options) => {
                  const args = unifyObjectStyle(_type, _payload, _options)
                  const { payload, options } = args
                  let { type } = args

                  if (!options || !options.root) {
                      type = namespace + type
                      if (__DEV__ && !store._mutations[type]) {
                          console.error(
                              `[vuex] unknown local mutation type: ${args.type}, global type: ${type}`
                          )
                          return
                      }
                  }

                  store.commit(type, payload, options)
              }
    }

    Object.defineProperties(local, {
        getters: {
            get: noNamespace ? () => store.getters : () => makeLocalGetters(store, namespace)
        },
        state: {
            get: () => getNestedState(store.state, path)
        }
    })

    return local
}

function makeLocalGetters(store, namespace) {
    if (!store._makeLocalGettersCache[namespace]) {
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
        store._makeLocalGettersCache[namespace] = gettersProxy
    }

    return store._makeLocalGettersCache[namespace]
}

function registerMutation(store, type, handler, local) {
    const entry = store._mutations[type] || (store._mutations[type] = [])
    entry.push(function wrappedMutationHandler(payload) {
        handler.call(store, local.state, payload)
    })
}

function registerAction(store, type, handler, local) {
    const entry = store._actions[type] || (store._actions[type] = [])
    entry.push(function wrappedActionHandler(payload) {
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
            payload
        )
        // action 返回一个promise
        if (!isPromise(res)) {
            res = Promise.resolve(res)
        }
        if (store._devtoolHook) {
            return res.catch(err => {
                store._devtoolHook.emit('vuex:error', err)
                throw err
            })
        } else {
            return res
        }
    })
}

function registerGetter(store, type, rawGetter, local) {
    if (store._wrappedGetters[type]) {
        if (__DEV__) {
            console.error(`[vuex] duplicate getter key: ${type}`)
        }
        return
    }
    store._wrappedGetters[type] = function wrappedGetter(store) {
        return rawGetter(
            local.state, // local state
            local.getters, // local getters
            store.state, // root state
            store.getters // root getters
        )
    }
}

function getNestedState(state, path) {
    return path.reduce((state, key) => state[key], state)
}

function unifyObjectStyle(type, payload, options) {
    if (isObject(type) && type.type) {
        options = payload
        payload = type
        type = type.type
    }

    if (__DEV__) {
        assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
    }

    return { type, payload, options }
}

// 1、挂载
// use时候的开始
export function install(_Vue) {
    // 校验vue已经被挂载，却传入和Vue相同 => 已经use过了
    if (Vue && _Vue === Vue) {
        if (__DEV__) {
            console.error('[vuex] already installed. Vue.use(Vuex) should be called only once.')
        }
        return
    }
    Vue = _Vue
    // 开始主流程 做混入操作
    applyMixin(Vue)
}
