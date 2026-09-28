import { Hint } from '../../src/core/types';
import { runFixtureSuite } from './fixture-suite';

runFixtureSuite('macros', (hint: Hint) => ({
  line: hint.line,
  text: hint.text,
  kind: hint.kind,
  inactive: hint.inactive,
}));
