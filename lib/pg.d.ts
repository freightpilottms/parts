declare module 'pg' {
 export interface PoolClient {query(text:string,values?:unknown[]):Promise<{rows:any[],rowCount:number|null}>;release():void}
 export class Pool {constructor(config:Record<string,unknown>);query(text:string,values?:unknown[]):Promise<{rows:any[],rowCount:number|null}>;connect():Promise<PoolClient>;end():Promise<void>}
}
