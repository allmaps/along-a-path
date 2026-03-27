<script lang="ts">
  import { base } from '$app/paths'
  import { onMount } from 'svelte'
  import {
    ArrowCounterClockwiseIcon,
    MinusIcon,
    PauseIcon,
    PlayIcon,
    PlusIcon
  } from 'phosphor-svelte'

  import LinkedMap from '$lib/components/LinkedMap.svelte'
  import { DEFAULT_MAP_COLUMNS } from '$lib/map-styles'
  import type {
    CameraState,
    LngLatTuple,
    MapColumnConfig,
    PathsGeoJson
  } from '$lib/map-types'

  const PLAYBACK_DURATION_MS = 50000
  let allColumns = $state<MapColumnConfig[]>(DEFAULT_MAP_COLUMNS)
  let visibleColumnIds = $state<string[]>(DEFAULT_MAP_COLUMNS.map((c) => c.id))
  let visibleColumns = $derived(
    allColumns.filter((c) => visibleColumnIds.includes(c.id))
  )
  let canRemove = $derived(visibleColumnIds.length > 1)
  let canAdd = $derived(visibleColumnIds.length < allColumns.length)

  const emptyRoute: PathsGeoJson = { type: 'FeatureCollection', features: [] }

  type InternationalString = Record<string, string[]>

  type AnnotationResource = {
    label?: InternationalString
    partOf?: AnnotationResource[]
  }

  type AnnotationDocument = {
    target?: {
      source?: AnnotationResource
    }
  }

  let routeData = $state<PathsGeoJson | null>(null)
  let routeCoordinates = $state<LngLatTuple[]>([])
  let routeCenter = $state<LngLatTuple | null>(null)
  let isPlaying = $state(false)
  let playbackProgress = $state(0)
  let playbackFrame = 0
  let playbackStartedAt = 0

  let camera = $state<CameraState>({
    center: [-122.506102, 37.736972],
    zoom: 15.6,
    bearing: 14.2,
    pitch: 53,
    source: null,
    sequence: 0
  })

  function updateCamera(nextCamera: Omit<CameraState, 'sequence'>) {
    camera = {
      ...nextCamera,
      sequence: camera.sequence + 1
    }
  }

  function distanceBetween(a: LngLatTuple, b: LngLatTuple) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]

    return Math.sqrt(dx * dx + dy * dy)
  }

  function bearingBetween(a: LngLatTuple, b: LngLatTuple) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]

    return (Math.atan2(dx, dy) * 180) / Math.PI
  }

  function interpolateRoutePosition(
    coordinates: LngLatTuple[],
    progress: number
  ) {
    if (coordinates.length === 0) {
      return null
    }

    if (coordinates.length === 1) {
      return {
        coordinate: coordinates[0],
        bearing: camera.bearing
      }
    }

    const segmentLengths = coordinates.slice(0, -1).map((coordinate, index) => {
      return distanceBetween(coordinate, coordinates[index + 1])
    })
    const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0)
    const targetDistance = totalLength * progress

    let traversed = 0

    for (let index = 0; index < segmentLengths.length; index += 1) {
      const segmentLength = segmentLengths[index]

      if (traversed + segmentLength >= targetDistance) {
        const segmentProgress =
          segmentLength === 0 ? 0 : (targetDistance - traversed) / segmentLength
        const start = coordinates[index]
        const end = coordinates[index + 1]

        return {
          coordinate: [
            start[0] + (end[0] - start[0]) * segmentProgress,
            start[1] + (end[1] - start[1]) * segmentProgress
          ] as LngLatTuple,
          bearing: bearingBetween(start, end)
        }
      }

      traversed += segmentLength
    }

    const end = coordinates.at(-1) ?? coordinates[0]
    const previous = coordinates.at(-2) ?? end

    return {
      coordinate: end,
      bearing: bearingBetween(previous, end)
    }
  }

  function extractFirstRoute(data: PathsGeoJson) {
    const firstLineString = data.features.find(
      (feature) => feature.geometry.type === 'LineString'
    )
    return firstLineString?.geometry.coordinates ?? []
  }

  function makeSingleRouteFeatureCollection(
    coordinates: LngLatTuple[]
  ): PathsGeoJson {
    if (coordinates.length === 0) {
      return emptyRoute
    }

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates
          }
        }
      ]
    }
  }

  function readInternationalString(value?: InternationalString) {
    if (!value) {
      return null
    }

    for (const strings of Object.values(value)) {
      const text = strings.find((entry) => entry.trim().length > 0)

      if (text) {
        return text
      }
    }

    return null
  }

  function extractAnnotationLabel(
    resource?: AnnotationResource
  ): string | null {
    if (!resource) {
      return null
    }

    const directLabel = readInternationalString(resource.label)

    if (directLabel) {
      return directLabel
    }

    for (const parent of resource.partOf ?? []) {
      const label = extractAnnotationLabel(parent)

      if (label) {
        return label
      }
    }

    return null
  }

  async function loadColumnLabels(columns: MapColumnConfig[]) {
    const resolvedColumns = await Promise.all(
      columns.map(async (column, index) => {
        if (!column.annotationUrl) {
          return column
        }

        try {
          const response = await fetch(column.annotationUrl)
          const annotation = (await response.json()) as AnnotationDocument
          const label = extractAnnotationLabel(annotation.target?.source)

          return {
            ...column,
            label: label ?? `Map #${index + 1}`
          }
        } catch {
          return {
            ...column,
            label: `Map #${index + 1}`
          }
        }
      })
    )

    allColumns = resolvedColumns
  }

  function removeLastColumn() {
    if (visibleColumnIds.length > 1) {
      visibleColumnIds = visibleColumnIds.slice(0, -1)
    }
  }

  function removeColumn(id: string) {
    if (visibleColumnIds.length > 1) {
      visibleColumnIds = visibleColumnIds.filter((vid) => vid !== id)
    }
  }

  function addColumn() {
    const next = allColumns.find((c) => !visibleColumnIds.includes(c.id))
    if (next) {
      visibleColumnIds = [...visibleColumnIds, next.id]
    }
  }

  function stopPlayback() {
    isPlaying = false
    cancelAnimationFrame(playbackFrame)

    if (routeCenter) {
      camera = {
        ...camera,
        center: routeCenter,
        sequence: camera.sequence + 1
      }
    }
  }

  function playbackStep(timestamp: number) {
    if (!isPlaying) {
      return
    }

    const nextProgress = Math.min(
      (timestamp - playbackStartedAt) / PLAYBACK_DURATION_MS,
      1
    )
    const position = interpolateRoutePosition(routeCoordinates, nextProgress)

    playbackProgress = nextProgress

    if (position) {
      routeCenter = position.coordinate
    }

    if (nextProgress >= 1) {
      playbackProgress = 0
      routeCenter = routeCoordinates[0] ?? routeCenter
      playbackStartedAt = timestamp
    }

    playbackFrame = requestAnimationFrame(playbackStep)
  }

  function startPlayback() {
    if (routeCoordinates.length === 0) {
      return
    }

    cancelAnimationFrame(playbackFrame)
    isPlaying = true
    routeCenter =
      playbackProgress === 0
        ? (routeCoordinates[0] ?? camera.center)
        : (routeCenter ?? camera.center)
    playbackStartedAt =
      performance.now() - playbackProgress * PLAYBACK_DURATION_MS
    playbackFrame = requestAnimationFrame(playbackStep)
  }

  function restartPlayback() {
    playbackProgress = 0
    routeCenter = routeCoordinates[0] ?? null

    if (isPlaying) {
      cancelAnimationFrame(playbackFrame)
      playbackStartedAt = performance.now()
      playbackFrame = requestAnimationFrame(playbackStep)
      return
    }

    if (routeCenter) {
      camera = {
        ...camera,
        center: routeCenter,
        sequence: camera.sequence + 1
      }
    }
  }

  function togglePlayback() {
    if (isPlaying) {
      stopPlayback()
      return
    }

    startPlayback()
  }

  onMount(() => {
    let isMounted = true

    const loadRoute = async () => {
      const response = await fetch(`${base}/assets/paths.geojson`)
      const data = (await response.json()) as PathsGeoJson

      if (!isMounted) {
        return
      }

      routeCoordinates = extractFirstRoute(data)
      routeData = makeSingleRouteFeatureCollection(routeCoordinates)
      routeCenter = null
    }

    void loadColumnLabels(DEFAULT_MAP_COLUMNS as MapColumnConfig[])
    void loadRoute()

    return () => {
      isMounted = false
      stopPlayback()
    }
  })
</script>

<svelte:head>
  <title>Drone Flight Comparator</title>
  <meta
    name="description"
    content="Linked MapLibre views with synchronized camera controls and route playback."
  />
</svelte:head>

<div
  class="grid h-screen grid-rows-[auto_1fr] bg-slate-900 font-['IBM_Plex_Sans','Avenir_Next','Segoe_UI',sans-serif] text-slate-900"
>
  <header
    class="z-10 border-b border-white/10 bg-slate-950/90 px-4 py-2 text-slate-50 backdrop-blur-xl flex flex-row items-center gap-1"
  >
    <h1 class="text-lg font-bold tracking-[0.08em]">Allmaps</h1>
    <h2 class="text-sm font-medium tracking-[0.04em]">along a path</h2>
    <span class="opacity-50"
      >see <a
        class="underline"
        href="https://allmaps.org"
        target="_blank"
        rel="noopener noreferrer">allmaps.org</a
      > for more information</span
    >
    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        aria-label="Remove rightmost pane"
        disabled={!canRemove}
        onclick={removeLastColumn}
        class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/10 text-slate-50 transition-[transform,background-color] duration-150 ease-in-out hover:-translate-y-px hover:bg-white/16 disabled:pointer-events-none disabled:opacity-30"
      >
        <MinusIcon size={14} weight="bold" />
      </button>
      <button
        type="button"
        aria-label="Add next pane"
        disabled={!canAdd}
        onclick={addColumn}
        class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/10 text-slate-50 transition-[transform,background-color] duration-150 ease-in-out hover:-translate-y-px hover:bg-white/16 disabled:pointer-events-none disabled:opacity-30"
      >
        <PlusIcon size={14} weight="bold" />
      </button>
    </div>
  </header>

  <section
    class="grid h-full"
    style={`grid-template-columns: repeat(${visibleColumns.length}, minmax(0, 1fr));`}
  >
    {#each visibleColumns as column, index (column.id)}
      <LinkedMap
        {column}
        {camera}
        {routeCenter}
        routeData={routeData ?? emptyRoute}
        useHash={index === 0}
        showNavigationControl={index === visibleColumns.length - 1}
        onCameraChange={updateCamera}
        onRemove={column.id !== 'osm'
          ? () => removeColumn(column.id)
          : undefined}
      />
    {/each}
  </section>

  <div
    class="fixed bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/55 bg-slate-900/82 px-3 py-3 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl"
  >
    <button
      class="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-slate-50 transition-[transform,background-color] duration-150 ease-in-out hover:-translate-y-px hover:bg-white/16"
      type="button"
      aria-label="Restart from beginning"
      onclick={restartPlayback}
    >
      <ArrowCounterClockwiseIcon size={20} weight="bold" />
    </button>
    <button
      class:border-0={true}
      class:from-slate-900={isPlaying}
      class:to-slate-700={isPlaying}
      class:shadow-[0_10px_25px_rgba(15,23,42,0.35)]={isPlaying}
      class:from-orange-600={!isPlaying}
      class:to-orange-400={!isPlaying}
      class:shadow-[0_10px_25px_rgba(234,88,12,0.35)]={!isPlaying}
      class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-linear-to-br text-white transition-[transform,box-shadow,background] duration-150 ease-in-out hover:-translate-y-px"
      type="button"
      aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
      onclick={togglePlayback}
    >
      {#if isPlaying}
        <PauseIcon size={20} weight="fill" />
      {:else}
        <PlayIcon size={20} weight="fill" />
      {/if}
    </button>
  </div>
</div>
