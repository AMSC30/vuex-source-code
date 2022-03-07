import { isObject } from './util'

export const mapState = normalizeNamespace((namespace, states) => {
    const res = {}

    normalizeMap(states).forEach(({ key, val }) => {
        res[key] = function mappedState() {
            let state = this.$store.state
            let getters = this.$store.getters
            if (namespace) {
                const module = getModuleByNamespace(this.$store, 'mapState', namespace)
                if (!module) {
                    return
                }
                state = module.context.state
                getters = module.context.getters
            }
            return typeof val === 'function' ? val.call(this, state, getters) : state[val]
        }
        // mark vuex getter for devtools
        res[key].vuex = true
    })
    return res
})

export const mapMutations = normalizeNamespace((namespace, mutations) => {
    const res = {}
    if (__DEV__ && !isValidMap(mutations)) {
        console.error('[vuex] mapMutations: mapper parameter must be either an Array or an Object')
    }
    normalizeMap(mutations).forEach(({ key, val }) => {
        res[key] = function mappedMutation(...args) {
            // Get the commit method from store
            let commit = this.$store.commit
            if (namespace) {
                const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
                if (!module) {
                    return
                }
                commit = module.context.commit
            }
            return typeof val === 'function'
                ? val.apply(this, [commit].concat(args))
                : commit.apply(this.$store, [val].concat(args))
        }
    })
    return res
})

export const mapGetters = normalizeNamespace((namespace, getters) => {
    const res = {}
    if (__DEV__ && !isValidMap(getters)) {
        console.error('[vuex] mapGetters: mapper parameter must be either an Array or an Object')
    }
    normalizeMap(getters).forEach(({ key, val }) => {
        // The namespace has been mutated by normalizeNamespace
        val = namespace + val
        res[key] = function mappedGetter() {
            if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
                return
            }
            if (__DEV__ && !(val in this.$store.getters)) {
                console.error(`[vuex] unknown getter: ${val}`)
                return
            }
            return this.$store.getters[val]
        }
        // mark vuex getter for devtools
        res[key].vuex = true
    })
    return res
})

export const mapActions = normalizeNamespace((namespace, actions) => {
    const res = {}
    if (__DEV__ && !isValidMap(actions)) {
        console.error('[vuex] mapActions: mapper parameter must be either an Array or an Object')
    }
    normalizeMap(actions).forEach(({ key, val }) => {
        res[key] = function mappedAction(...args) {
            // get dispatch function from store
            let dispatch = this.$store.dispatch
            if (namespace) {
                const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
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

export const createNamespacedHelpers = namespace => ({
    mapState: mapState.bind(null, namespace),
    mapGetters: mapGetters.bind(null, namespace),
    mapMutations: mapMutations.bind(null, namespace),
    mapActions: mapActions.bind(null, namespace)
})

function normalizeMap(map) {
    if (!isValidMap(map)) {
        return []
    }
    return Array.isArray(map)
        ? map.map(key => ({ key, val: key }))
        : Object.keys(map).map(key => ({ key, val: map[key] }))
}

function isValidMap(map) {
    return Array.isArray(map) || isObject(map)
}

function normalizeNamespace(fn) {
    // 返回的map函数
    // 第一个参数接受命名空间
    // 第二个参数为映射关系
    return (namespace, map) => {
        if (typeof namespace !== 'string') {
            // map函数没有传入命名空间，如mapState({a:"a"})
            map = namespace
            namespace = ''
        } else if (namespace.charAt(namespace.length - 1) !== '/') {
            // 如果传入了命名空间，序列化命名空间，在末尾加上slash
            namespace += '/'
        }
        return fn(namespace, map)
    }
}

function getModuleByNamespace(store, helper, namespace) {
    // 此处是在store构造函数中installModule中进行缓存的
    const module = store._modulesNamespaceMap[namespace]
    if (__DEV__ && !module) {
        console.error(`[vuex] module namespace not found in ${helper}(): ${namespace}`)
    }
    return module
}
