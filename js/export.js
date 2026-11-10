import { parseEquation } from './parser.js';

function baseToLatex(baseFormula) {
  let result = '';
  for (let index = 0; index < baseFormula.length; index += 1) {
    const character = baseFormula[index];
    if (character === '·') {
      result += '\\cdot ';
      continue;
    }
    if (/\d/.test(character)) {
      let end = index + 1;
      while (end < baseFormula.length && /\d/.test(baseFormula[end])) end += 1;
      const digits = baseFormula.slice(index, end);
      result += index === 0 || baseFormula[index - 1] === '·' ? digits : `_{${digits}}`;
      index = end - 1;
      continue;
    }
    result += character;
  }
  return result;
}

export function speciesToLatex(species) {
  if (species.isElectron) return 'e^{-}';
  const charge = species.charge
    ? `^{${Math.abs(species.charge) > 1 ? Math.abs(species.charge) : ''}${species.charge > 0 ? '+' : '-'}}`
    : '';
  const annotation = species.annotation === '↑' ? '\\uparrow' : species.annotation === '↓' ? '\\downarrow' : '';
  const state = species.state ? `\\,(${species.state})` : '';
  return `${species.coefficient > 1 ? species.coefficient : ''}\\mathrm{${baseToLatex(species.baseFormula)}${charge}}${annotation}${state}`;
}

export function equationToLatex(input) {
  const equation = typeof input === 'string' ? parseEquation(input) : input;
  const separator = equation.separator === '⇄' || equation.separator === '↔' ? '\\rightleftharpoons' : '\\rightarrow';
  const left = equation.left.map(speciesToLatex).join(' + ');
  const right = equation.right.map(speciesToLatex).join(' + ');
  return `${left} ${separator} ${right}`;
}
