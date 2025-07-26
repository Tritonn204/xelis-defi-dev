import * as factoryEntries from './contracts/factory/entries';
import * as routerEntries from './contracts/router/entries';

type ParamType = 'String' | 'U64' | 'U8' | 'Boolean' | 'Hash' | 'Address';

interface ParamSchema {
  name: string;
  type: ParamType;
  default?: any;
}

import { ABI, TypedContract } from './utils/TypedContract';
import factoryABI from './abi/factory.abi.json';
import routerABI from './abi/router.abi.json';

const factory = new TypedContract("asd", factoryABI as ABI)
const router = new TypedContract("asd", routerABI as ABI)

type ParamSchemas = Record<string, ParamSchema[]>;

interface EntryGroup {
  entries: Record<string, (...args: any[]) => Record<string, any>>;
  params: ParamSchemas;
}

const entryGroups: Record<string, EntryGroup> = {
  factory: {
    entries: Object.fromEntries(
      factory.getMethods().map((method) => [
        `${method}`,
        (params: Record<string, any>) => factory.invoke(method, params)
      ])
    ),
    params: Object.fromEntries(
      factory.getMethods().map((methodName) => {
        const abi = factory.getMethodSignature(methodName)!;
        const paramSchemas: ParamSchema[] = abi.params.map((param: any) => ({
          name: param.name,
          type: param.type,
        }));
        return [methodName, paramSchemas];
      })
    )
  },

  router: {
    entries: Object.fromEntries(
      router.getMethods().map((method) => [
        `${method}`,
        (params: Record<string, any>) => router.invoke(method, params)
      ])
    ),
    params: Object.fromEntries(
      router.getMethods().map((methodName) => {
        const abi = router.getMethodSignature(methodName)!;
        const paramSchemas: ParamSchema[] = abi.params.map((param: any) => ({
          name: param.name,
          type: param.type,
        }));
        return [methodName, paramSchemas];
      })
    )
  }
};

function generateRandomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const contractDropdown = document.getElementById('contractSelect') as HTMLSelectElement;
  const functionDropdown = document.getElementById('entrySelect') as HTMLSelectElement;
  const paramContainer = document.getElementById('paramInputs')!;
  const generateBtn = document.getElementById('generateBtn')!;
  const outputBox = document.getElementById('output')!;
  const copyBtn = document.getElementById('copyBtn')!;

  const renderFunctionOptions = (contract: string) => {
    functionDropdown.innerHTML = '';
    const functions = Object.keys(entryGroups[contract].entries);
    functions.forEach(fn => {
      const option = document.createElement('option');
      option.value = fn;
      option.textContent = fn;
      functionDropdown.appendChild(option);
    });
    renderInputs(contract, functions[0]);
  };

  const renderInputs = (contract: string, fnName: string) => {
    const schema = entryGroups[contract].params[fnName];
    paramContainer.innerHTML = '';

    schema.forEach(param => {
      const wrapper = document.createElement('div');

      const label = document.createElement('label');
      label.textContent = `${param.name} (${param.type})`;
      label.htmlFor = param.name;

      const inputWrapper = document.createElement('div');
      inputWrapper.style.display = 'flex';
      inputWrapper.style.alignItems = 'center';
      inputWrapper.style.gap = '0.5rem';

      const input = document.createElement('input');
      input.id = param.name;
      input.name = param.name;

      switch (param.type) {
        case 'Boolean':
          input.type = 'checkbox';
          input.checked = param.default ?? false;
          break;
        case 'U64':
        case 'U8':
          input.type = 'number';
          input.value = param.default ?? '';
          break;
        default:
          input.type = 'text';
          input.value = param.default ?? '';
          break;
      }

      inputWrapper.appendChild(input);

      if (param.type === 'Hash') {
        const genBtn = document.createElement('button');
        genBtn.textContent = 'Generate';
        genBtn.type = 'button';
        genBtn.onclick = () => {
          input.value = generateRandomHex(64);
        };
        inputWrapper.appendChild(genBtn);
      }

      wrapper.appendChild(label);
      wrapper.appendChild(inputWrapper);
      wrapper.appendChild(document.createElement('br'));
      paramContainer.appendChild(wrapper);
    });
  };

  // Initial render
  renderFunctionOptions(contractDropdown.value);

  contractDropdown.addEventListener('change', () => {
    renderFunctionOptions(contractDropdown.value);
  });

  functionDropdown.addEventListener('change', () => {
    renderInputs(contractDropdown.value, functionDropdown.value);
  });

  generateBtn.onclick = () => {
    const contract = contractDropdown.value;
    const fnName = functionDropdown.value;
    const fn = entryGroups[contract].entries[fnName];
    const schema = entryGroups[contract].params[fnName];

    const params: any = {};
    schema.forEach(param => {
      const el = document.getElementById(param.name) as HTMLInputElement;
      switch (param.type) {
        case 'Boolean':
          params[param.name] = el.checked;
          break;
        case 'U64':
        case 'U8':
          params[param.name] = parseInt(el.value, 10);
          break;
        default:
          params[param.name] = el.value;
      }
    });

    try {
      const result = fn(params);
      outputBox.value = JSON.stringify(result, null, 2);
    } catch (err) {
      outputBox.value = `Error: ${err}`;
    }
  };

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(outputBox.value)
      .then(() => alert('Copied!'))
      .catch(err => alert(`Copy failed: ${err}`));
  };
});
