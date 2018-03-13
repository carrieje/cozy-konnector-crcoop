const Replay = require('replay')
Replay.fixtures = __dirname + "/fixtures";
const { requestFactory } = require('cozy-konnector-libs')

const rq = requestFactory({
  encoding: 'latin1',
  jar: true,
  json: false,
  cheerio: true
})

test('request', () => {
  return rq('https://www.credit-cooperatif.coop/portail/particuliers/login.do')
    .then($ => {
      expect($('.navSecurite').text()).toEqual('sécurité')
    })
})
