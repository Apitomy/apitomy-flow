export interface ActionTypeField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  description?: string;
}

export interface ActionTypeDescriptor {
  value: string;
  label: string;
  description?: string;
  inputs?: ActionTypeField[];
  outputs?: ActionTypeField[];
}

export type ActionTypeProvider =
  | ActionTypeDescriptor[]
  | (() => Promise<ActionTypeDescriptor[]>);

export interface EditorSpi {
  actionTypes?: ActionTypeProvider;
}
