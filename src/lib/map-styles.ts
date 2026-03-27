import { generateId } from '@allmaps/id'

import { allmapsBasemapStyle } from '$lib/allmaps-base-style.js'

import type { StyleSpecification } from 'maplibre-gl'

import type { MapColumnConfig } from '$lib/map-types.js'

async function makeAllmapsRasterStyle(
  annotationUrl: string
): Promise<StyleSpecification> {
  const id = await generateId(annotationUrl)

  return {
    version: 8,
    sources: {
      [id]: {
        type: 'raster',
        tiles: [
          `https://dev.allmaps.xyz/{z}/{x}/{y}@2x.webp?url=${encodeURIComponent(annotationUrl)}`
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.allmaps.org/">Allmaps</a> contributors',
        maxzoom: 19
      }
    },
    layers: [
      {
        id: id,
        type: 'raster',
        source: id
      }
    ]
  }
}

const annotationUrls = [
  'https://annotations.allmaps.org/maps/2768e9fd1d41e55c',
  'https://annotations.allmaps.org/maps/045cdafd6e043bd1',
  'https://annotations.allmaps.org/maps/41c07b2ee3fe0073',
  'https://annotations.allmaps.org/maps/3c28b9957511e9ec',
  'https://annotations.allmaps.org/maps/5a2dd967f983cd46'
]

export const DEFAULT_MAP_COLUMNS: MapColumnConfig[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    style: allmapsBasemapStyle('en')
  },
  ...(await Promise.all(
    annotationUrls.map(async (url, index) => ({
      id: url.replace('https://annotations.allmaps.org/', 'allmaps/'),
      label: `Map #${index + 2}`,
      style: await makeAllmapsRasterStyle(url),
      annotationUrl: url
    }))
  ))
]
