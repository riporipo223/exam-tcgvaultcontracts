declare module "chai" {
  interface Assertion {
    equal(val: unknown): void;
    to: Assertion;
    be: Assertion;
    not: Assertion;
    rejectedWith(regex: RegExp): Promise<void>;
    rejected: Promise<void>;
    gt(n: number | bigint): void;
    gte(n: number | bigint): void;
    lt(n: number | bigint): void;
    true: void;
    a(type: string): void;
  }
  export const expect: (val: unknown) => Assertion;
}
