<script lang="ts">
  import { onMount } from 'svelte'
  import type { GeoJSONSource, LngLatLike, Map } from 'maplibre-gl'

  import type {
    CameraState,
    MapColumnConfig,
    PathsGeoJson
  } from '$lib/map-types'

  type Props = {
    column: MapColumnConfig
    camera: CameraState
    routeCenter: CameraState['center'] | null
    routeData: PathsGeoJson | null
    useHash?: boolean
    showNavigationControl?: boolean
    onCameraChange: (camera: Omit<CameraState, 'sequence'>) => void
  }

  let {
    column,
    camera,
    routeCenter,
    routeData,
    useHash = false,
    showNavigationControl = false,
    onCameraChange
  }: Props = $props()

  let container: HTMLDivElement

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
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
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
    class="absolute left-4 top-4 z-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-900/82 px-3 py-2 text-[0.8rem] font-semibold tracking-[0.04em] text-slate-50 backdrop-blur-[12px]"
  >
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
      <span>{column.label}</span>
    {/if}
  </div>
</div>
