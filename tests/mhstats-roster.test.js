import { describe, it, expect } from 'vitest';
import { MAINLINE_GAMES, GAME_SOURCE, slugify, parseMonsterPage } from '../tools/mhstats/roster.js';

describe('mhstats roster', () => {
  it('orders the mainline games by release', () => {
    expect(MAINLINE_GAMES).toEqual(['MH1', 'MHG', 'MHF1', 'MH2', 'MHF2', 'MHFU', 'MH3', 'MHP3', 'MH3U',
      'MH4', 'MH4U', 'MHGen', 'MHGU', 'MHWorld', 'MHWI', 'MHRise', 'MHRS', 'MHWilds']);
    for (const g of MAINLINE_GAMES) expect(GAME_SOURCE[g]).toBeTruthy();
  });

  it('slugifies names with apostrophes, dots and spaces', () => {
    expect(slugify("Safi'jiiva")).toBe('safi-jiiva');
    expect(slugify('Plum D.Hermitaur')).toBe('plum-d-hermitaur');
    expect(slugify('Yian Kut-Ku')).toBe('yian-kut-ku');
  });

  it('reads flags, japanese name and image out of a wiki page', () => {
    const wikitext = '{{Meta\n|MetaImage = File:MHWilds-Rathalos Render 001.webp\n}}\n' +
      '{{MonsterAppearancesNav\n|MH1 = Y\n|MHWilds = Y\n|MHFrontier = Y\n|Music = Y\n}}\n' +
      '{{MonsterGameInfoBox_Overview\n|English Name = Rathalos\n|Japanese Name = リオレウス\n' +
      '|Image = MHWilds-Rathalos Render 001.webp\n}}';
    const r = parseMonsterPage('Rathalos', wikitext);
    expect(r).toMatchObject({
      id: 'rathalos', name: 'Rathalos', ja: 'リオレウス',
      debut: 'MH1', latest: 'MHWilds', source: 'Wilds',
    });
    expect(r.games).toEqual(['MH1', 'MHWilds']);
    expect(r.image).toBe('MHWilds-Rathalos Render 001.webp');
  });

  it('strips the template-default wrapper around an image field', () => {
    const wikitext = '{{MonsterAppearancesNav\n|MH4U = Y\n}}\n{{MonsterGameInfoBox_Overview\n' +
      '|Japanese Name = ダラ・アマデュラ\n|Image = {{{Render|MH4U-Dalamadur Render.png}}}\n}}';
    expect(parseMonsterPage('Dalamadur', wikitext).image).toBe('MH4U-Dalamadur Render.png');
  });

  it('returns null for a page with no mainline appearance', () => {
    expect(parseMonsterPage('Slime', '{{MonsterAppearancesNav\n|MHST1 = Y\n}}')).toBeNull();
  });
});
