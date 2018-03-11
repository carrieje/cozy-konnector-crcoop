'use strict'
const {
  BaseKonnector,
  addData,
  log,
  requestFactory,
  updateOrCreate
} = require('cozy-konnector-libs')
const connection = require('./connection')
const csv = require('csv-parse/lib/sync')
const bluebird = require('bluebird')
const moment = require('moment-timezone')
moment.locale('fr')
moment.tz.setDefault('Europe/Paris')

const baseUrl = `https://www.credit-cooperatif.coop`
module.export = new BaseKonnector(start)

const rq = requestFactory({
  encoding: 'latin1',
  jar: true,
  json: false,
  cheerio: true
})

function start (fields) {
  return login(fields)
  .then(parseAccounts)
  .then(fetchIBANs)
  .then(saveAccounts)
  .then(accounts =>
    bluebird.each(accounts, account => {
      return fetchOperations(account)
        .then(saveOperations)
    })
  )
}

function validateLogin (statusCode, $) {
  const isValid = $('.errorForm-msg ul').text().trim() === ''
  if (!isValid) { log('warn', $('.errorForm-msg ul').text().trim()) }
  return isValid
}

function login (fields) {
  log('info', 'Logging in')
  const page = 'portail/particuliers/login.do'
  const population = {
    'j_username': fields.login,
    'j_password': fields.password
  }
  return connection.init(
    baseUrl,
    page,
    '#AuthForm',
    population,
    validateLogin,
    'cheerio',
    { encoding: 'latin1' }
  )
}

function parseAccounts () {
  log('info', 'Gettings accounts')

  return rq(`${baseUrl}/portail/particuliers/mescomptes/synthese.do`)
  .then($ => {
    const accounts = Array.from($('#content table thead'))
      .map(item => {
        // NOTE It is possible that the user has given their account a pseudo
        return {
          type: 'bank',
          institutionLabel: 'Crédit Coopératif',
          label: $(item).find('.tt_compte').text().trim(),
          balance: parseAmount($(item).find('.sum_solde span').eq(1).text()),
          number: $(item).find('.nClient li').eq(1).text().trim().replace('N°', '')
        }
      })

    return Promise.resolve(accounts)
  })
}

function fetchIBANs (accounts) {
  log('info', 'Fetching IBANs')

  return Promise.all(
    accounts.map(account => {
      return rq({
        uri: `${baseUrl}/portail/particuliers/mesoperations/ribiban/telechargementribajax.do`,
        method: 'POST',
        form: { accountExternalNumber: account.number }
      }).then($ => {
        return Promise.resolve({
          iban: $('.iban').first().text().trim(),
          ...account
        })
      })
    })
  )
}

function saveAccounts (accounts) {
  return updateOrCreate(accounts, 'io.cozy.bank.accounts', ['institutionLabel', 'number'])
}

function fetchOperations (account) {
  log('info', `Gettings operations for ${account.label} over the last 10 years`)

  // TODO Evaluate necessity for such navigation
  return rq({
    uri: `${baseUrl}/portail/particuliers/mescomptes/relevedesoperations.do`,
    method: 'POST',
    form: {
      accountExternalNumber: account.number
    }
  }).then(() => {
    return rq({
      uri: `${baseUrl}/portail/particuliers/mescomptes/telechargementoperationsajax.do`,
      method: 'POST'
    })
  }).then($ => {
    let [action, inputs] = parseForm($, '#downloadForm')
    const eldest = moment.tz(inputs.dateSolde, 'DD/MM/YYYY', 'Europe/Paris')
    const tenYearsAgo = eldest.subtract(10, 'year').format('DD/MM/YYYY')
    inputs = {
      ...inputs,
      dateDebOp: tenYearsAgo,
      dateFinOp: inputs.dateSolde,
      outputFomatType: '3'
    }
    return queryOperations(`${baseUrl}/${action}`, inputs)
  }).then(operations => {
    return Promise.resolve(
      operations.map(operation => {
        return {
          label: operation['Libellé'],
          type: 'none', // TODO parse the labels for that
          date: parseDate(operation['Date']),
          amount: parseAmount(operation['Montant'], operation['Sens']),
          currency: 'EUR',
          account: account._id
        }
      })
    )
  })
}

function queryOperations (uri, inputs) {
  return rq({
    uri: uri,
    method: 'POST',
    encoding: 'latin1', // TODO Remove following line as v3.6.1 is released
    form: inputs,
    transform: (body) => {
      return csv(body, {
        columns: true,
        relax_column_count: true,
        delimiter: ';',
        trim: true
      })
    }
  })
}

function saveOperations (operations) {
  return addData(operations, 'io.cozy.bank.operations')
}

function parseAmount (amount, transaction = 'CREDIT') {
  const sign = (transaction === 'DEBIT' ? -1 : +1)
  return sign * parseFloat(amount.trim().replace(/[^0-9,+-]/g, '').replace(',', '.'))
}

function parseDate (date) {
  return moment.tz(date, 'D MMM YYYY', 'Europe/Paris').format()
}

function parseForm ($, formSelector) {
  const action = $(formSelector).attr('action')
  const inputs = {}
  const arr = $(formSelector).serializeArray()
  for (let input of arr) {
    inputs[input.name] = input.value
  }
  return [action, inputs]
}
