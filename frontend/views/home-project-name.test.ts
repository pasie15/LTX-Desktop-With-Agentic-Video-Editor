import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PROJECT_NAME,
  nextUntitledProjectName,
  resolveNewProjectName,
} from './home-project-name.ts'

describe('new project name', () => {
  it('starts at Untitled Project and increments past collisions', () => {
    assert.equal(nextUntitledProjectName([]), DEFAULT_PROJECT_NAME)
    assert.equal(nextUntitledProjectName(['Untitled Project']), 'Untitled Project 2')
    assert.equal(
      nextUntitledProjectName(['Untitled Project', 'Untitled Project 2']),
      'Untitled Project 3',
    )
  })

  it('creates even when the field is blank', () => {
    assert.equal(resolveNewProjectName('  ', []), DEFAULT_PROJECT_NAME)
    assert.equal(resolveNewProjectName('Midnight River', []), 'Midnight River')
  })
})
