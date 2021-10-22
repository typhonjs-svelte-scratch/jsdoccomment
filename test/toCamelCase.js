// eslint-disable-next-line no-shadow -- Forced to import now
import {expect} from 'chai';

import toCamelCase from '../src/toCamelCase.js';

describe('toCamelCase', function () {
  it('work with underscores', function () {
    expect(toCamelCase('test_one')).to.equal('TestOne');
  });
});
