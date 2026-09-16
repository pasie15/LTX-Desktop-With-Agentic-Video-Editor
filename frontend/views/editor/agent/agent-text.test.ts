import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  defaultDurationForTextRole,
  normalizeTextOverlays,
  parseLyricLines,
  parseTextRole,
  styleForTextRole,
} from './agent-text.ts'

describe('agent text roles', () => {
  it('maps aliases onto designed modules', () => {
    assert.equal(parseTextRole('lyrics'), 'lyrics')
    assert.equal(parseTextRole('lower-third'), 'lower_third')
    assert.equal(parseTextRole('shot-slug'), 'shot_title')
    assert.equal(parseTextRole('opening title'), 'title')
    assert.equal(defaultDurationForTextRole('title'), 3)
    assert.equal(defaultDurationForTextRole('shot_title'), 2)
  })

  it('keeps lyrics readable at the bottom and titles centered', () => {
    const lyrics = styleForTextRole('lyrics', 'Midnight by the river')
    assert.equal(lyrics.text, 'Midnight by the river')
    assert.equal(lyrics.positionY, 82)
    assert.equal(lyrics.positionX, 50)
    assert.equal(lyrics.textAlign, 'center')
    assert.ok((lyrics.fontSize ?? 0) >= 36)
    assert.ok((lyrics.strokeWidth ?? 0) > 0)

    const title = styleForTextRole('title', 'Ken Tune')
    assert.equal(title.positionY, 50)
    assert.ok((title.fontSize ?? 0) >= 64)

    const slug = styleForTextRole('shot_title', 'STREET - NIGHT')
    assert.equal(slug.positionY, 10)
    assert.ok((slug.fontSize ?? 0) <= 28)

    const lower = styleForTextRole('lower_third', 'Ken Tune')
    assert.equal(lower.textAlign, 'left')
    assert.ok((lower.positionY ?? 0) >= 80)
  })

  it('parses timed lyric lines', () => {
    const overlays = parseLyricLines('[0s] Midnight by the river\nI keep walking (5s)')
    assert.equal(overlays.length, 2)
    assert.equal(overlays[0]?.text, 'Midnight by the river')
    assert.equal(overlays[0]?.startTime, 0)
    assert.equal(overlays[0]?.role, 'lyrics')
    assert.equal(overlays[1]?.text, 'I keep walking')
    assert.equal(overlays[1]?.startTime, 5)
    assert.deepEqual(normalizeTextOverlays([
      { text: 'Name', role: 'lower_third', startTime: 2, duration: 3 },
    ])[0]?.role, 'lower_third')
  })
})
