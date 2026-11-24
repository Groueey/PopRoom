export function addMapQueriesToManifest<T extends Record<string, unknown>>(
  androidManifest: T,
): T;

declare function withAndroidMapQueries<T>(config: T): T;

declare namespace withAndroidMapQueries {
  export { addMapQueriesToManifest };
}

export default withAndroidMapQueries;
