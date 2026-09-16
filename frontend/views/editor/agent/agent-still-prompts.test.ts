import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { frameIdentityImagePrompt, isLookbookPrompt, sceneStillPromptForVideo } from './agent-still-prompts.ts'

describe('identity image prompt framing', () => {
  it('leads scene stills with a medium-wide cinematic frame', () => {
    const framed = frameIdentityImagePrompt('Ken on a wet street at night')
    assert.match(framed, /^Cinematic 16:9 production still/)
    assert.match(framed, /Ken on a wet street/)
    assert.match(framed, /Not a studio headshot/)
    assert.equal(frameIdentityImagePrompt(framed), framed)
  })

  it('leads character sheets with a full-body T-pose reference sheet', () => {
    assert.equal(isLookbookPrompt('Character sheet of Ken'), true)
    assert.equal(isLookbookPrompt('T-pose front and back'), true)
    const framed = frameIdentityImagePrompt('Character sheet / lookbook of Ken Tune')
    assert.match(framed, /^Full-body character reference sheet/)
    assert.match(framed, /T-pose front/)
    assert.match(framed, /not a facial close-up/i)
    assert.equal(frameIdentityImagePrompt(framed), framed)
  })

  it('never mints a lookbook when framing a video start', () => {
    const fromSheet = sceneStillPromptForVideo('Character sheet / lookbook of Ken Tune, T-pose')
    assert.match(fromSheet, /^Cinematic 16:9 production still/)
    assert.equal(isLookbookPrompt(fromSheet), false)
    const fromScene = sceneStillPromptForVideo('Ken on a wet street at night')
    assert.match(fromScene, /Ken on a wet street/)
  })

  it('keeps empty scenes empty and rewrites still close-ups to medium shots', () => {
    const empty = frameIdentityImagePrompt('wide moonlit river, no people')
    assert.match(empty, /wide establishing shot/)
    assert.match(empty, /No people/)
    assert.doesNotMatch(empty, /A person stands or walks/)
    const close = frameIdentityImagePrompt('Ken Tune identity, open leather jacket, close-up midnight')
    assert.match(close, /medium shot with the location visible/)
    assert.doesNotMatch(close, /close-up midnight/i)
  })
})
