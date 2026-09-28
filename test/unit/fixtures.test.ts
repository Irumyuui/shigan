import { Hint } from '../../src/core/types';
import { runFixtureSuite } from './fixture-suite';

runFixtureSuite('brackets', (hint: Hint) => ({
  line: hint.line,
  text: hint.text,
  kind: hint.kind,
  openLine: hint.openLine,
  closeLine: hint.closeLine,
  inactive: hint.inactive,
}));
