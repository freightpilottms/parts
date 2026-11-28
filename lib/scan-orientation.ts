import {categories} from './shared';

export const orientations = ['fender_nose_left', 'fender_nose_right', 'lamp_outer_edge_left',
 'lamp_outer_edge_right', 'unknown'] as const;
type Orientation = typeof orientations[number];
type Category = typeof categories[number];

// Left and right in the result are always from the seated driver's perspective.
export function resolveScanSide(name:string, category:Category, orientation:Orientation, marking:string) {
 const fender = /blatobran/i.test(category) || /\bblatobran\b/i.test(name);
 const headlamp = /\bfar\b/i.test(category) || /\bfar\b/i.test(name);
 if (!fender && !headlamp) return {name,category};
 if (/nosač|nosac|oblog|potkril|poklop|staklo|modul|maglen|žmigav|okvir|rešetk/i.test(name.split(/\s+(?:sa|s)\s+/i)[0]))
  return {name,category:'Ostali dijelovi' as const};
 let geometry = '';
 if (fender && orientation.startsWith('fender_nose_')) geometry = orientation.endsWith('_left') ? 'Lijevi' : 'Desni';
 if (headlamp && orientation.startsWith('lamp_outer_edge_')) geometry = orientation.endsWith('_left') ? 'Desni' : 'Lijevi';
 const label = marking === 'LH' ? 'Lijevi' : marking === 'RH' ? 'Desni' : '';
 const side = label && geometry && label !== geometry ? '' : label || geometry;
 const noun = fender ? 'blatobran' : 'far';
 const neutralName = name.replace(/\b(?:lijevi|levi|desni|lijev|lev|desan)\b/gi,'').replace(/\s+/g,' ').trim() || noun;
 const description = neutralName.charAt(0).toLowerCase() + neutralName.slice(1);
 return {name:side ? side+' '+description : neutralName.charAt(0).toUpperCase()+neutralName.slice(1),
  category:(side ? side+' '+noun : 'Ostali dijelovi') as Category};
}
