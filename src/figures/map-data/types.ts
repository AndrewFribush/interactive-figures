// Region geometry for sheet maps: real coastlines compiled into the repo by
// scripts/build-map-data.mjs from Natural Earth (public domain).

export interface MapRegion {
  name: string;
  /** [west, south, east, north] in degrees. */
  bbox: [number, number, number, number];
  /** Closed coastline rings as [lon, lat] vertex lists (draw with evenodd fill). */
  rings: [number, number][][];
}
