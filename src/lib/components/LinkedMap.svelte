<script lang="ts">
  import { onMount } from 'svelte'
  import { CheckIcon, CodeIcon, CopyIcon, XIcon } from 'phosphor-svelte'
  import type {
    GeoJSONSource,
    LngLatLike,
    Map,
    RasterLayerSpecification,
    RasterSourceSpecification,
    StyleSpecification
  } from 'maplibre-gl'

  import type {
    CameraState,
    MapColumnConfig,
    PathsGeoJson
  } from '$lib/map-types.js'

  type Props = {
    column: MapColumnConfig
    camera: CameraState
    routeCenter: CameraState['center'] | null
    routeData: PathsGeoJson | null
    useHash?: boolean
    showNavigationControl?: boolean
    onCameraChange: (camera: Omit<CameraState, 'sequence'>) => void
    onRemove?: () => void
  }

  let {
    column,
    camera,
    routeCenter,
    routeData,
    useHash = false,
    showNavigationControl = false,
    onCameraChange,
    onRemove
  }: Props = $props()

  let container: HTMLDivElement

  let showStylePopup = $state(false)
  let copied = $state(false)
  let highlightedHtml = $state<string | null>(null)

  async function highlightCode(code: string) {
    const { highlight } = await import('$lib/highlight.js')
    highlightedHtml = await highlight(code)
  }

  function generateStyleCode(column: {
    style: StyleSpecification | string
  }): string {
    if (typeof column.style === 'string') return ''
    const spec = column.style as StyleSpecification
    const sourceId = Object.keys(spec.sources)[0]
    if (!sourceId) return ''
    const source = spec.sources[sourceId] as RasterSourceSpecification
    const layer = spec.layers[0] as RasterLayerSpecification
    const sourceCode = JSON.stringify(
      {
        type: source.type,
        tiles: source.tiles,
        tileSize: source.tileSize,
        attribution: source.attribution,
        maxzoom: source.maxzoom
      },
      null,
      2
    )
    const layerCode = JSON.stringify(
      { id: layer.id, type: layer.type, source: layer.source },
      null,
      2
    )
    return `map.addSource('${sourceId}', ${sourceCode});\n\nmap.addLayer(${layerCode});`
  }

  function openStylePopup() {
    showStylePopup = !showStylePopup
    if (showStylePopup && !highlightedHtml) {
      void highlightCode(generateStyleCode(column))
    }
  }

  function copyStyle() {
    if (!column.annotationUrl) return
    const code = generateStyleCode(column)
    navigator.clipboard.writeText(code).then(() => {
      copied = true
      setTimeout(() => {
        copied = false
      }, 2000)
    })
  }

  let map: Map | null = null
  let isApplyingSync = false
  let isApplyingRouteCenter = false
  let isUserControllingCamera = false
  let interactionReleaseTimeout = 0
  let lastSequence = -1
  let lastRouteCenterKey = ''

  const routeSourceId = 'route'

  function syncFromSharedCamera(nextCamera: CameraState) {
    if (
      !map ||
      nextCamera.source === column.id ||
      nextCamera.sequence === lastSequence
    ) {
      return
    }

    isApplyingSync = true
    map.jumpTo({
      center: nextCamera.center as LngLatLike,
      zoom: nextCamera.zoom,
      bearing: nextCamera.bearing,
      pitch: nextCamera.pitch
    })
    lastSequence = nextCamera.sequence

    requestAnimationFrame(() => {
      isApplyingSync = false
    })
  }

  function ensureRouteLayers() {
    if (!map || map.getSource(routeSourceId)) {
      return
    }

    map.addSource(routeSourceId, {
      type: 'geojson',
      data: routeData ?? { type: 'FeatureCollection', features: [] }
    })

    map.addLayer({
      id: 'route-glow',
      type: 'line',
      source: routeSourceId,
      paint: {
        'line-color': '#f97316',
        'line-width': 16,
        'line-blur': 4,
        'line-opacity': 0.65
      }
    })

    map.addLayer({
      id: 'route-outline',
      type: 'line',
      source: routeSourceId,
      paint: {
        'line-color': '#f8fafc',
        'line-width': 10,
        'line-opacity': 0.98
      }
    })

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: routeSourceId,
      paint: {
        'line-color': '#fb7185',
        'line-width': 6,
        'line-opacity': 1
      }
    })
  }

  function updateRouteSource(nextRouteData: PathsGeoJson | null) {
    if (!map) {
      return
    }

    ensureRouteLayers()

    const source = map.getSource(routeSourceId) as GeoJSONSource | undefined
    source?.setData(
      nextRouteData ?? { type: 'FeatureCollection', features: [] }
    )
  }

  function syncRouteCenter(nextRouteCenter: CameraState['center'] | null) {
    if (
      !map ||
      !nextRouteCenter ||
      isUserControllingCamera ||
      map.isZooming() ||
      map.isRotating()
    ) {
      return
    }

    const routeCenterKey = `${nextRouteCenter[0]},${nextRouteCenter[1]}`

    if (routeCenterKey === lastRouteCenterKey) {
      return
    }

    isApplyingRouteCenter = true
    map.setCenter(nextRouteCenter as LngLatLike)
    lastRouteCenterKey = routeCenterKey

    requestAnimationFrame(() => {
      isApplyingRouteCenter = false
    })
  }

  onMount(() => {
    let cancelled = false
    const beginCameraInteraction = () => {
      window.clearTimeout(interactionReleaseTimeout)
      isUserControllingCamera = true
    }
    const endCameraInteraction = () => {
      window.clearTimeout(interactionReleaseTimeout)
      interactionReleaseTimeout = window.setTimeout(() => {
        isUserControllingCamera = false
      }, 160)
    }
    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (event.ctrlKey || event.button === 2) {
        beginCameraInteraction()
      }
    }
    const handleMouseUp = () => {
      endCameraInteraction()
    }
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        beginCameraInteraction()
      }
    }
    const handleTouchEnd = () => {
      endCameraInteraction()
    }

    container.addEventListener('contextmenu', preventContextMenu)
    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('touchstart', handleTouchStart, {
      passive: true
    })
    window.addEventListener('touchend', handleTouchEnd)

    const setupMap = async () => {
      const maplibregl = await import('maplibre-gl')

      if (cancelled) {
        return
      }

      map = new maplibregl.Map({
        container,
        style: column.style,
        center: camera.center,
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: camera.pitch,
        hash: useHash,
        attributionControl: false
      })

      map.dragRotate.enable()
      map.touchPitch.enable()
      map.touchZoomRotate.enable()
      map.touchZoomRotate.enableRotation()

      if (showNavigationControl) {
        map.addControl(
          new maplibregl.NavigationControl({ visualizePitch: true }),
          'top-right'
        )
      }

      map.on('load', () => {
        ensureRouteLayers()
        updateRouteSource(routeData)
      })

      map.on('rotatestart', () => {
        beginCameraInteraction()
      })

      map.on('rotateend', () => {
        endCameraInteraction()
      })

      map.on('pitchstart', () => {
        beginCameraInteraction()
      })

      map.on('pitchend', () => {
        endCameraInteraction()
      })

      map.on('zoomstart', () => {
        beginCameraInteraction()
      })

      map.on('zoomend', () => {
        endCameraInteraction()
      })

      map.on('touchstart', () => {
        beginCameraInteraction()
      })

      map.on('touchend', () => {
        endCameraInteraction()
      })

      map.on('move', () => {
        if (!map || isApplyingSync || isApplyingRouteCenter) {
          return
        }

        const center = map.getCenter()
        onCameraChange({
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
          source: column.id
        })
      })
    }

    void setupMap()

    return () => {
      cancelled = true
      window.clearTimeout(interactionReleaseTimeout)
      container.removeEventListener('contextmenu', preventContextMenu)
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchend', handleTouchEnd)
      map?.remove()
      map = null
    }
  })

  $effect(() => {
    syncFromSharedCamera(camera)
  })

  $effect(() => {
    syncRouteCenter(routeCenter)
  })

  $effect(() => {
    updateRouteSource(routeData)
  })
</script>

<div
  class="relative h-full min-h-0 overflow-hidden border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.2),rgba(15,23,42,0.55)),radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_35%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
>
  <div bind:this={container} class="h-full min-h-0 touch-none"></div>
  <div
    class:max-w-[calc(100%-5.5rem)]={showNavigationControl}
    class:max-w-[calc(100%-2rem)]={!showNavigationControl}
    class="absolute left-4 top-4 z-1 flex items-center gap-1.5 rounded-full bg-slate-900/82 py-1.5 pl-3 text-[0.8rem] font-semibold tracking-[0.04em] text-slate-50 backdrop-blur-md"
    class:pr-2={onRemove || column.annotationUrl}
    class:pr-3={!onRemove && !column.annotationUrl}
  >
    <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
      {#if column.annotationUrl}
        <a
          href={`https://viewer.allmaps.org/?url=${encodeURIComponent(column.annotationUrl)}`}
          target="_blank"
          rel="noreferrer"
          class="hover:underline"
        >
          {column.label}
        </a>
      {:else}
        {column.label}
      {/if}
    </span>
    {#if column.annotationUrl}
      <button
        type="button"
        aria-label="Copy MapLibre style code"
        onclick={() => {
          openStylePopup()
        }}
        class="flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
        class:opacity-100={showStylePopup}
      >
        <CodeIcon size={12} weight="bold" />
      </button>
    {/if}
    {#if onRemove}
      <button
        type="button"
        aria-label="Remove pane"
        onclick={onRemove}
        class="flex shrink-0 cursor-pointer items-center justify-center rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <XIcon size={12} weight="bold" />
      </button>
    {/if}
  </div>

  {#if showStylePopup && column.annotationUrl}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      role="presentation"
      class="absolute inset-0 z-0"
      onclick={() => {
        showStylePopup = false
      }}
    ></div>
    <div
      class="absolute left-4 top-14 z-2 w-[min(26rem,calc(100%-2rem))] rounded-xl border border-white/10 bg-slate-950/95 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      <div
        class="flex items-center justify-between border-b border-white/10 px-4 py-2.5"
      >
        <span
          class="text-[0.75rem] font-semibold tracking-[0.06em] text-slate-400 uppercase"
          >MapLibre style snippet</span
        >
        <button
          type="button"
          aria-label="Close"
          onclick={() => {
            showStylePopup = false
          }}
          class="cursor-pointer text-slate-400 opacity-60 transition-opacity hover:opacity-100"
        >
          <XIcon size={14} weight="bold" />
        </button>
      </div>
      {#if highlightedHtml}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="shiki-wrapper overflow-x-auto">{@html highlightedHtml}</div>
      {:else}
        <pre class="overflow-x-auto px-4 py-3 text-[0.72rem] leading-relaxed text-slate-300"><code>{generateStyleCode(column)}</code></pre>
      {/if}
      <div class="border-t border-white/10 px-4 py-2.5">
        <button
          type="button"
          onclick={copyStyle}
          class="flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[0.75rem] font-semibold text-slate-50 transition-[transform,background-color] duration-150 hover:-translate-y-px hover:bg-white/16"
        >
          {#if copied}
            <CheckIcon size={13} weight="bold" />
            Copied!
          {:else}
            <CopyIcon size={13} weight="bold" />
            Copy code
          {/if}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .shiki-wrapper :global(pre) {
    padding: 0.75rem 1rem;
    font-size: 0.72rem;
    line-height: 1.6;
    background: transparent !important;
  }

  .shiki-wrapper :global(code) {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }
</style>
