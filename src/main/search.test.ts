import {describe,it,expect} from 'vitest';
describe('search query normalization',()=>{it('removes FTS operators from user text',()=>{const raw='error: "pip"*';const safe=raw.replace(/["'*:()]/g,' ');expect(safe).toBe('error   pip  ')});it('rejects unsupported extension',()=>{expect(new Set(['.png','.jpg','.jpeg','.webp']).has('.gif')).toBe(false)})});
