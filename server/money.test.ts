import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decimalAmount, displayMoney } from '../dashboard/src/domain/money'
import { todayIsoDate, setPersonalTimezone } from '../dashboard/src/domain/format'

test('money validation rejects rounding and formatting keeps exact fractional digits',()=>{
  assert.equal(decimalAmount.parse('999999999999999.1234'),'999999999999999.1234')
  for (const value of ['0','0.0000','1.12345','NaN','Infinity','1e3','1000000000000000']) assert.equal(decimalAmount.safeParse(value).success,false,value)
  assert.equal(displayMoney('999999999999999.1234','EUR'),'€999,999,999,999,999.1234')
  assert.equal(displayMoney('250.5000','EUR'),'€250.5')
})
test('personal timezone is explicit and invalid timezone is rejected',()=>{
  setPersonalTimezone('Europe/Lisbon')
  assert.match(todayIsoDate(),/^\d{4}-\d{2}-\d{2}$/)
  assert.throws(()=>setPersonalTimezone('unknown/timezone'))
})
