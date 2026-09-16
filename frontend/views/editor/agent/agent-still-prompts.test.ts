import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { frameIdentityImagePrompt, isLookbookPrompt } from './agent-still-prompts.ts'

describe('identity image prompt framing', () => {
  it('leads scene stills with a medium-wide cinematic frame', () => {
    const framed = frameIdentityImagePrompt('Ken on a wet street at night')
    assert.match(framed, /^Cinematic 16:9 production still/)
    assert.match(framed, /Ken on a wet street/)
    assert.match(framed, /Not a studio headshot/)
    assert.equal(frameIdentityImagePrompt(framed), framed)
  })

  it('leads character sheets with a full-body lookbook grid', () => {
    assert.equal(isLookbookPrompt('Character sheet of Ken'), true)
    const framed = frameIdentityImagePrompt('Character sheet / lookbook of Ken Tune')
    assert.match(framed, /^Full-body character lookbook grid/)
    assert.match(framed, /Not a facial close-up/)
    assert.equal(frameIdentityImagePrompt(framed), framed)
  })
})
