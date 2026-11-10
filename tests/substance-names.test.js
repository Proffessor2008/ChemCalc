import test from 'node:test';
import assert from 'node:assert/strict';
import { findSubstance } from '../js/checker.js';

const names = {
  K2FeO4: 'Феррат калия', BaFeO4: 'Феррат бария', Na2Cr2O7: 'Дихромат натрия', CsMnO4: 'Перманганат цезия', K2MnO4: 'Манганат калия', Na2CrO4: 'Хромат натрия', BaCrO4: 'Хромат бария', 'Ca(MnO4)2': 'Перманганат кальция',
  Mg3P2: 'Фосфид магния', Ca3N2: 'Нитрид кальция', Al4C3: 'Карбид алюминия', Li3N: 'Нитрид лития', Mg2Si: 'Силицид магния', FeS2: 'Дисульфид железа (пирит)', CuFeS2: 'Дисульфид железа-меди (халькопирит)', Cu2S: 'Сульфид меди(I)',
  'Na[Al(OH)4]': 'Тетрагидроксоалюминат натрия', 'K3[Fe(OH)6]': 'Гексагидроксоферрат(III) калия', 'K4[Fe(CN)6]': 'Гексацианоферрат(II) калия', 'K3[Cr(OH)6]': 'Гексагидроксохромат(III) калия', 'Na2[Zn(OH)4]': 'Тетрагидроксоцинкат натрия', 'K3[Fe(CN)6]': 'Гексацианоферрат(III) калия', '[Ag(NH3)2]Cl': 'Хлорид диамминсеребра(I)',
  FeCl3: 'Хлорид железа(III)', I2: 'Иод', KI: 'Иодид калия', KMnO4: 'Перманганат калия', '[Cu(NH3)4](OH)2': 'Гидроксид тетраамминмеди(II)'
};

test('все заданные вещества имеют русские названия', () => {
  for (const [formula, expected] of Object.entries(names)) assert.equal(findSubstance(formula)?.name_ru, expected, formula);
});

test('неправильная запись Cu(NH3)42 не выдаётся за гидроксид', () => {
  const record = findSubstance('Cu(NH3)42');
  assert.equal(record.class, 'invalid');
  assert.match(record.name_ru, /Некорректная запись/);
  assert.match(record.name_ru, /\[Cu\(NH3\)4\]\(OH\)2/);
});
