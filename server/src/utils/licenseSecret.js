// The entire offline license scheme's security boundary — see the header
// comment in server/src/utils/licenseKey.js. This value ships inside every
// packaged install (offline verification can't work any other way). NEVER
// change it after issuing real keys: every previously issued key is derived
// from it and would stop validating.
module.exports = {
  signingSecret: process.env.LICENSE_SIGNING_SECRET || 'c19202204aa137ce29e2a618a36128b62e2ecaa9f259ca31b4af281be3d34314'
};
