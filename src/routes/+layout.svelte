<script lang="ts">
	import './layout.css';
	import logo from '$lib/assets/logo.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={logo} /></svelte:head>
{@render children()}
