export class BudgetError extends Error {code:string;status:number;beforeDispatch:boolean}
export interface BudgetStore {execute(options:any):Promise<any>}
export function createBudgetStore(db:any,env?:Record<string,string|undefined>):BudgetStore;
