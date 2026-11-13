import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import {db} from './db';
export function hash(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verify(password:string,value:string){const [salt,key]=value.split(':');const actual=scryptSync(password,salt,64);return timingSafeEqual(actual,Buffer.from(key,'hex'));}
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function user(){const token=(await cookies()).get('parts_session')?.value;if(!token)return null;const {rows}=await db.query('SELECT u.id,u.username,u.must_change FROM parts_app.sessions s JOIN parts_app.users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires>now()',[digest(token)]);return rows[0]??null;}
export async function session(id:string){const token=randomBytes(32).toString('hex');await db.query("INSERT INTO parts_app.sessions(token,user_id,expires) VALUES($1,$2,now()+interval '30 days')",[digest(token),id]);(await cookies()).set('parts_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:2592000});}
export async function rate(key:string,limit:number,seconds:number){const {rows}=await db.query('INSERT INTO parts_app.limits(key,count,expires) VALUES($1,1,now()+$2*interval \'1 second\') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN parts_app.limits.expires<now() THEN 1 ELSE parts_app.limits.count+1 END, expires=CASE WHEN parts_app.limits.expires<now() THEN excluded.expires ELSE parts_app.limits.expires END RETURNING count',[key,seconds]);if(rows[0].count>limit)throw Object.assign(Error('Previše pokušaja. Pokušajte kasnije.'),{status:429});}
