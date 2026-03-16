import type { StyleSpecification } from 'maplibre-gl'

export type LngLatTuple = [number, number]

export type CameraState = {
  center: LngLatTuple
  zoom: number
  bearing: number
  pitch: number
  source: string | null
  sequence: number
}

export type LineStringFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: {
    type: 'LineString'
    coordinates: LngLatTuple[]
  }
}

export type PathsGeoJson = {
  type: 'FeatureCollection'
  features: LineStringFeature[]
}

export type MapColumnConfig = {
  id: string
  label: string
  style: StyleSpecification | string
  annotationUrl?: string
}
