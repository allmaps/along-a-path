<script lang="ts">
  import './layout.css'
  import favicon from '$lib/assets/favicon.png'
  import 'maplibre-gl/dist/maplibre-gl.css'

  let { children } = $props()
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
