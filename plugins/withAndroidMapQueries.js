const { withAndroidManifest } = require('expo/config-plugins');

const MAP_SCHEMES = ['androidamap', 'baidumap'];

/**
 * Idempotently appends Android 11+ `<queries><intent>` entries for Amap and Baidu Map URI schemes
 * so `Linking.canOpenURL` resolves installed map apps accurately in standalone Android builds.
 */
function addMapQueriesToManifest(androidManifest) {
  if (!androidManifest || typeof androidManifest !== 'object') {
    return androidManifest;
  }

  if (!androidManifest.manifest || typeof androidManifest.manifest !== 'object') {
    androidManifest.manifest = {};
  }

  const manifestRoot = androidManifest.manifest;
  if (!Array.isArray(manifestRoot.queries) || manifestRoot.queries.length === 0) {
    manifestRoot.queries = [{}];
  }

  const queriesNode = manifestRoot.queries[0];
  if (!Array.isArray(queriesNode.intent)) {
    queriesNode.intent = [];
  }

  const existingSchemes = new Set();
  for (const intentEntry of queriesNode.intent) {
    const dataEntries = Array.isArray(intentEntry?.data) ? intentEntry.data : [];
    for (const dataEntry of dataEntries) {
      const scheme = dataEntry?.$?.['android:scheme'];
      if (typeof scheme === 'string') {
        existingSchemes.add(scheme);
      }
    }
  }

  for (const scheme of MAP_SCHEMES) {
    if (existingSchemes.has(scheme)) {
      continue;
    }
    queriesNode.intent.push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': scheme } }],
    });
    existingSchemes.add(scheme);
  }

  return androidManifest;
}

function withAndroidMapQueries(config) {
  return withAndroidManifest(config, (modConfig) => {
    addMapQueriesToManifest(modConfig.modResults);
    return modConfig;
  });
}

withAndroidMapQueries.addMapQueriesToManifest = addMapQueriesToManifest;

module.exports = withAndroidMapQueries;
