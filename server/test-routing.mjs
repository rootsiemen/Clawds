import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Automated tests for notification tiers and loop limits (issue #10).
// Uses the routing test hooks exported from core.mjs — no server needed.
const core = await import('./core.mjs')
const { isAll, parseMentions, tier1Allowed, handoffAllowed, tier1Log, handoffLog } = core.__routingTest__
const S = core.getState()

// Minimal bot roster so byHandle() resolves @handles in parseMentions tests.
function seedBots() {
  S.bots = [{ id: 'bot1' }, { id: 'bot2' }]
  S.accounts = {
    bot1: { id: 'bot1', username: 'helper' },
    bot2: { id: 'bot2', username: 'worker' },
    me: { id: 'me', username: 'me' },
  }
}

beforeEach(() => {
  seedBots()
  tier1Log.clear()
  handoffLog.length = 0
  // restore default loop-protection settings in case a test changed them
  Object.assign(S.settings, { handoffPair: 3, handoffTotal: 10, handoffWindow: 10, allCooldown: 10, maxChainDepth: 2 })
})

describe('isAll — /all detection', () => {
  it('detects /all at start of message', () => {
    assert.equal(isAll('/all hello everyone'), true)
  })
  it('detects /all mid-message', () => {
    assert.equal(isAll('hello /all please read'), true)
  })
  it('detects @all', () => {
    assert.equal(isAll('hey @all'), true)
  })
  it('does not match /all inside a word', () => {
    assert.equal(isAll('install/all done'), false)
  })
  it('does not match plain text', () => {
    assert.equal(isAll('hello @helper'), false)
  })
})

describe('parseMentions — notification tiers', () => {
  it('human @bot is tier 2 (wakes the bot)', () => {
    const tiers = parseMentions('hey @helper do this', 'me')
    assert.equal(tiers.get('bot1'), 2)
  })
  it('human [low]@bot is tier 3 (notify only)', () => {
    const tiers = parseMentions('fyi [low]@helper', 'me')
    assert.equal(tiers.get('bot1'), 3)
  })
  it('bot @bot without tag is tier 3 (notify only)', () => {
    const tiers = parseMentions('@helper see this', 'bot2')
    assert.equal(tiers.get('bot1'), 3)
  })
  it('bot [high]@bot is tier 2 (wakes the bot)', () => {
    const tiers = parseMentions('[high]@helper urgent', 'bot2')
    assert.equal(tiers.get('bot1'), 2)
  })
  it('skips self-mentions', () => {
    const tiers = parseMentions('@helper talking to myself', 'bot1')
    assert.equal(tiers.has('bot1'), false)
  })
  it('skips unknown handles', () => {
    const tiers = parseMentions('hey @nobody', 'me')
    assert.equal(tiers.size, 0)
  })
  it('lowest tier wins when mentioned twice', () => {
    const tiers = parseMentions('@helper please [low]@helper later', 'me')
    assert.equal(tiers.get('bot1'), 2)
  })
  it('resolves bots by username, not just id', () => {
    const tiers = parseMentions('@worker go', 'me')
    assert.equal(tiers.get('bot2'), 2)
  })
})

describe('tier1Allowed — /all cooldown', () => {
  it('human (me) is never rate-limited', () => {
    S.settings.allCooldown = 10
    tier1Log.set('ch1', Date.now())
    assert.equal(tier1Allowed('me', 'ch1'), true)
  })
  it('first /all from a bot is allowed', () => {
    assert.equal(tier1Allowed('bot1', 'ch1'), true)
  })
  it('second /all within cooldown is denied', () => {
    assert.equal(tier1Allowed('bot1', 'ch1'), true)
    assert.equal(tier1Allowed('bot1', 'ch1'), false)
  })
  it('/all is allowed again after cooldown expires', () => {
    S.settings.allCooldown = 10
    tier1Log.set('ch1', Date.now() - 11 * 60_000)
    assert.equal(tier1Allowed('bot1', 'ch1'), true)
  })
  it('cooldown is per-channel', () => {
    assert.equal(tier1Allowed('bot1', 'ch1'), true)
    assert.equal(tier1Allowed('bot1', 'ch2'), true)
  })
  it('zero cooldown disables the limit', () => {
    S.settings.allCooldown = 0
    assert.equal(tier1Allowed('bot1', 'ch1'), true)
    assert.equal(tier1Allowed('bot1', 'ch1'), true)
  })
})

describe('handoffAllowed — loop protection', () => {
  it('allows handoffs under the pair limit', () => {
    assert.equal(handoffAllowed('bot1', 'bot2'), true)
    assert.equal(handoffAllowed('bot1', 'bot2'), true)
    assert.equal(handoffAllowed('bot1', 'bot2'), true)
  })
  it('blocks the pair after handoffPair handoffs', () => {
    S.settings.handoffPair = 3
    for (let i = 0; i < 3; i++) assert.equal(handoffAllowed('bot1', 'bot2'), true)
    assert.equal(handoffAllowed('bot1', 'bot2'), false)
  })
  it('pair limit does not affect other pairs', () => {
    S.settings.handoffPair = 1
    assert.equal(handoffAllowed('bot1', 'bot2'), true)
    assert.equal(handoffAllowed('bot1', 'bot2'), false)
    assert.equal(handoffAllowed('bot2', 'bot1'), true)
  })
  it('blocks everything after handoffTotal handoffs', () => {
    S.settings.handoffTotal = 2
    S.settings.handoffPair = 0 // disable pair limit for this test
    assert.equal(handoffAllowed('bot1', 'bot2'), true)
    assert.equal(handoffAllowed('bot2', 'bot1'), true)
    assert.equal(handoffAllowed('bot1', 'bot2'), false)
  })
  it('old entries outside handoffWindow do not count', () => {
    S.settings.handoffPair = 1
    S.settings.handoffWindow = 10
    handoffLog.push({ ts: Date.now() - 11 * 60_000, from: 'bot1', to: 'bot2' })
    assert.equal(handoffAllowed('bot1', 'bot2'), true)
  })
})
