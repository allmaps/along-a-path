import type { StyleSpecification } from 'maplibre-gl'

import { allmapsBasemapStyle } from '$lib/allmaps-base-style.js'
import type { MapColumnConfig } from '$lib/map-types.js'

function makeAllmapsRasterStyle(mapId: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      [mapId]: {
        type: 'raster',
        tiles: [`https://dev.allmaps.xyz/maps/${mapId}/{z}/{x}/{y}@2x.webp`],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.allmaps.org/">Allmaps</a> contributors',
        maxzoom: 19
      }
    },
    layers: [
      {
        id: mapId,
        type: 'raster',
        source: mapId
      }
    ]
  }
}

export const DEFAULT_MAP_COLUMNS: MapColumnConfig[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    style: allmapsBasemapStyle('en')
  },
  {
    id: 'allmaps/maps/045cdafd6e043bd1',
    label: 'Map #2',
    style: makeAllmapsRasterStyle('045cdafd6e043bd1'),
    annotationUrl: 'https://annotations.allmaps.org/maps/045cdafd6e043bd1'
  },
  {
    id: 'allmaps/maps/2768e9fd1d41e55c',
    label: 'Map #3',
    style: makeAllmapsRasterStyle('2768e9fd1d41e55c'),
    annotationUrl: 'https://annotations.allmaps.org/maps/2768e9fd1d41e55c'
  },
  {
    id: 'allmaps/maps/41c07b2ee3fe0073',
    label: 'Map #4',
    style: makeAllmapsRasterStyle('41c07b2ee3fe0073'),
    annotationUrl: 'https://annotations.allmaps.org/maps/41c07b2ee3fe0073'
  }
]
