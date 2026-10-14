/** @file Verifies named captured-output parsing and its diagnostic causes. */
import {describe, expect, it} from 'bun:test';
import {parseJsonOutput} from './support/documented-example-contracts.ts';

describe('documented example captured JSON output', () => {
  it('parses the final JSON line after command diagnostics', () => {
    expect(parseJsonOutput({stdout: 'request complete\n{"ok":true}\n', label: 'repository curl'})).toEqual({ok: true});
  });

  it('uses the output label when no JSON line is present', () => {
    expect(() => parseJsonOutput({stdout: '  \n', label: 'repository curl'})).toThrow(
      'repository curl produced no JSON output'
    );
  });

  it('keeps a distinct output label and the JSON parser cause', () => {
    let failure: unknown;

    try {
      parseJsonOutput({stdout: 'request complete\nnot-json\n', label: 'user curl'});
    } catch (error) {
      failure = error;
    }

    if (!(failure instanceof Error)) {
      throw new Error('invalid JSON output should produce an Error');
    }

    expect(failure.message).toBe('user curl produced invalid JSON');
    expect(failure.cause).toBeInstanceOf(SyntaxError);
  });
});
