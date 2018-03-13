'use strict'
const {BaseKonnector, addData, updateOrCreate} = require('cozy-konnector-libs')
const bluebird = require('bluebird')
const {login, parseAccounts, fetchIBANs, fetchOperations} = require('./lib')

module.export = new BaseKonnector(start)

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

function saveAccounts (accounts) {
  return updateOrCreate(accounts, 'io.cozy.bank.accounts', ['institutionLabel', 'number'])
}

function saveOperations (operations) {
  return addData(operations, 'io.cozy.bank.operations')
}
