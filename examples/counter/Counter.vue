<template>
    <div id="app">
        Clicked: {{ $store.state.count }} times, count is {{ evenOrOdd }}.
        <button @click="increment">+</button>
        <button @click="decrement">-</button>
        <button @click="incrementIfOdd">Increment if odd</button>
        <button @click="incrementAsync">Increment async</button>
    </div>
</template>

<script>
import { mapGetters, mapActions } from "vuex";
import Vue from "vue";
export default {
    computed: mapGetters(["evenOrOdd"]),
    methods: mapActions([
        "increment",
        "decrement",
        "incrementIfOdd",
        "incrementAsync",
    ]),
    created() {
        console.log(this.$store);
    },
};
</script>
