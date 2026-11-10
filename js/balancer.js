import { formatEquation, parseEquation } from './parser.js';

function bigintGcd(a, b) {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right) [left, right] = [right, left % right];
  return left;
}

function bigintLcm(a, b) {
  if (a === 0n || b === 0n) return 0n;
  return (a / bigintGcd(a, b)) * b;
}

export class Fraction {
  constructor(numerator, denominator = 1n) {
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d === 0n) throw new RangeError('Знаменатель дроби не может быть нулём');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const divisor = bigintGcd(n, d) || 1n;
    this.n = n / divisor;
    this.d = d / divisor;
    Object.freeze(this);
  }

  static from(value) {
    if (value instanceof Fraction) return value;
    if (typeof value === 'string' && value.includes('/')) {
      const [numerator, denominator] = value.split('/');
      return new Fraction(numerator, denominator);
    }
    return new Fraction(value);
  }

  add(other) {
    const value = Fraction.from(other);
    return new Fraction(this.n * value.d + value.n * this.d, this.d * value.d);
  }

  sub(other) {
    const value = Fraction.from(other);
    return new Fraction(this.n * value.d - value.n * this.d, this.d * value.d);
  }

  mul(other) {
    const value = Fraction.from(other);
    return new Fraction(this.n * value.n, this.d * value.d);
  }

  div(other) {
    const value = Fraction.from(other);
    if (value.n === 0n) throw new RangeError('Деление на ноль');
    return new Fraction(this.n * value.d, this.d * value.n);
  }

  neg() {
    return new Fraction(-this.n, this.d);
  }

  isZero() {
    return this.n === 0n;
  }

  equals(other) {
    const value = Fraction.from(other);
    return this.n === value.n && this.d === value.d;
  }

  toNumber() {
    return Number(this.n) / Number(this.d);
  }

  toString() {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
  }
}

export function nullspace(inputMatrix) {
  const matrix = inputMatrix.map((row) => row.map(Fraction.from));
  if (!matrix.length || !matrix[0].length) return [];
  const rowCount = matrix.length;
  const columnCount = matrix[0].length;
  if (matrix.some((row) => row.length !== columnCount)) throw new RangeError('Матрица должна быть прямоугольной');
  const pivotColumns = [];
  let pivotRow = 0;
  for (let column = 0; column < columnCount && pivotRow < rowCount; column += 1) {
    let selected = pivotRow;
    while (selected < rowCount && matrix[selected][column].isZero()) selected += 1;
    if (selected === rowCount) continue;
    [matrix[pivotRow], matrix[selected]] = [matrix[selected], matrix[pivotRow]];
    const pivot = matrix[pivotRow][column];
    matrix[pivotRow] = matrix[pivotRow].map((value) => value.div(pivot));
    for (let row = 0; row < rowCount; row += 1) {
      if (row === pivotRow || matrix[row][column].isZero()) continue;
      const factor = matrix[row][column];
      matrix[row] = matrix[row].map((value, index) => value.sub(factor.mul(matrix[pivotRow][index])));
    }
    pivotColumns.push(column);
    pivotRow += 1;
  }
  const pivotSet = new Set(pivotColumns);
  const freeColumns = Array.from({ length: columnCount }, (_, index) => index).filter((index) => !pivotSet.has(index));
  return freeColumns.map((freeColumn) => {
    const vector = Array.from({ length: columnCount }, () => new Fraction(0));
    vector[freeColumn] = new Fraction(1);
    pivotColumns.forEach((column, row) => {
      vector[column] = matrix[row][freeColumn].neg();
    });
    return vector;
  });
}

export function vectorToMinimalIntegers(vector) {
  const denominator = vector.reduce((multiple, value) => bigintLcm(multiple, value.d), 1n);
  let integers = vector.map((value) => value.n * (denominator / value.d));
  const divisor = integers.reduce((common, value) => bigintGcd(common, value), 0n) || 1n;
  integers = integers.map((value) => value / divisor);
  if (integers.some((value) => value < 0n) && integers.some((value) => value > 0n)) {
    return { integers, positive: false };
  }
  if (integers.some((value) => value < 0n)) integers = integers.map((value) => -value);
  const positive = integers.every((value) => value > 0n);
  if (integers.every((value) => value <= Number.MAX_SAFE_INTEGER)) {
    return { integers: integers.map(Number), positive };
  }
  return { integers, positive };
}

export function buildBalanceMatrix(equation) {
  const species = [...equation.left, ...equation.right];
  const symbols = [];
  const seen = new Set();
  for (const item of species) {
    for (const symbol of item.atoms.keys()) {
      if (!seen.has(symbol)) {
        seen.add(symbol);
        symbols.push(symbol);
      }
    }
  }
  const matrix = symbols.map((symbol) => species.map((item, index) => {
    const sign = index < equation.left.length ? 1 : -1;
    return new Fraction(sign * (item.atoms.get(symbol) || 0));
  }));
  if (species.some((item) => item.charge !== 0)) {
    matrix.push(species.map((item, index) => new Fraction((index < equation.left.length ? 1 : -1) * item.charge)));
  }
  return { matrix, symbols };
}

export function balanceEquation(input) {
  const equation = typeof input === 'string' ? parseEquation(input) : input;
  const { matrix, symbols } = buildBalanceMatrix(equation);
  const basis = nullspace(matrix);
  if (basis.length === 0) {
    return { status: 'no-solution', message: 'Ненулевого решения нет: проверьте формулы и стороны уравнения', equation, symbols };
  }
  if (basis.length > 1) {
    return {
      status: 'underdetermined',
      nullity: basis.length,
      message: `Решений бесконечно много: недостаёт ${basis.length - 1} независимых условий. Уточните продукты или коэффициенты.`,
      equation,
      symbols
    };
  }
  const { integers, positive } = vectorToMinimalIntegers(basis[0]);
  if (!positive) {
    return {
      status: 'no-positive-solution',
      message: 'Уравнение нельзя уравнять положительными коэффициентами. Проверьте, нет ли лишнего вещества или элемента только в продуктах.',
      equation,
      symbols
    };
  }
  return {
    status: 'balanced',
    equation,
    symbols,
    coefficients: integers,
    leftCoefficients: integers.slice(0, equation.left.length),
    rightCoefficients: integers.slice(equation.left.length),
    formatted: formatEquation(equation, integers)
  };
}

function normalizeCoefficients(equation, coefficients) {
  const values = coefficients || [...equation.left, ...equation.right].map((species) => species.coefficient);
  const expected = equation.left.length + equation.right.length;
  if (values.length !== expected) throw new RangeError(`Ожидается ${expected} коэффициентов`);
  return values.map((value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new RangeError('Все коэффициенты должны быть положительными целыми числами');
    return number;
  });
}

export function numberGcd(values) {
  const result = values.reduce((common, value) => {
    let a = Math.abs(value);
    let b = Math.abs(common);
    while (b) [a, b] = [b, a % b];
    return a;
  }, 0);
  return result || 1;
}

export function inspectBalance(input, coefficients = null) {
  const equation = typeof input === 'string' ? parseEquation(input) : input;
  const values = normalizeCoefficients(equation, coefficients);
  const species = [...equation.left, ...equation.right];
  const { symbols } = buildBalanceMatrix(equation);
  const atomRows = symbols.map((symbol) => {
    const left = equation.left.reduce((sum, item, index) => sum + values[index] * (item.atoms.get(symbol) || 0), 0);
    const right = equation.right.reduce((sum, item, index) => sum + values[equation.left.length + index] * (item.atoms.get(symbol) || 0), 0);
    return { symbol, left, right, balanced: left === right };
  });
  const chargeLeft = equation.left.reduce((sum, item, index) => sum + values[index] * item.charge, 0);
  const chargeRight = equation.right.reduce((sum, item, index) => sum + values[equation.left.length + index] * item.charge, 0);
  const massLeft = equation.left.reduce((sum, item, index) => sum + values[index] * item.molarMass, 0);
  const massRight = equation.right.reduce((sum, item, index) => sum + values[equation.left.length + index] * item.molarMass, 0);
  const coefficientGcd = numberGcd(values);
  const atomsBalanced = atomRows.every((row) => row.balanced);
  const chargeBalanced = chargeLeft === chargeRight;
  return {
    equation,
    coefficients: values,
    atomRows,
    charge: { left: chargeLeft, right: chargeRight, balanced: chargeBalanced },
    mass: { left: massLeft, right: massRight, balanced: Math.abs(massLeft - massRight) < 1e-7 * Math.max(1, massLeft, massRight) },
    isBalanced: atomsBalanced && chargeBalanced,
    coefficientGcd,
    isMinimal: coefficientGcd === 1
  };
}
