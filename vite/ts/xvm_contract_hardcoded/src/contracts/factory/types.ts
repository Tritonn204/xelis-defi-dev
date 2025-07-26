/**
 * Parameters for creating a new token
 * @description Creates a new fungible token with specified properties
 * @example
 * ```typescript
 * const params: CreateTokenParams = {
 *   contract: (hex)"token_factory...",
 *   name: "My Token",
 *   ticker: "MTK",
 *   decimals: 18,
 *   supply: 1000000,
 *   mintable: true,
 *   maxSupply: 10000000,
 *   maxGas: 250000000
 * };
 * ```
 */
export interface CreateTokenParams {
  /**
   * Address of the token factory contract
   * @example (hex)"token_factory..."
   */
  contract: string;
  
  /**
   * Full name of the token
   * @example "My Token"
   * @minLength 1
   * @maxLength 32
   */
  name: string;
  
  /**
   * Token ticker symbol
   * @example "MTK"
   * @minLength 1
   * @maxLength 8
   */
  ticker: string;
  
  /**
   * Number of decimal places for the token
   * @description Typically 18 for most tokens, but can range from 0-18
   * @minimum 0
   * @maximum 18
   * @default 18
   */
  decimals: number;
  
  /**
   * Initial token supply (before decimal adjustment)
   * @description This value will be multiplied by 10^decimals internally
   * @minimum 0
   * @example 1000000 // For 1M tokens
   */
  supply: number;
  
  /**
   * Whether additional tokens can be minted after creation
   * @description If true, the token owner can mint new tokens up to maxSupply
   * @default false
   */
  mintable: boolean;
  
  /**
   * Maximum possible token supply (before decimal adjustment)
   * @description Only enforced if mintable is true. Must be >= initial supply
   * @minimum 0
   * @example 10000000 // For 10M max tokens
   */
  maxSupply: number;
  
  /**
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;

  /**
   * Direct URL to web-compatible icon for the token
   * @example "https://logo.com/icon.png"
   * @minLength 0
   * @default empty
   * @maxLength 256
   */
  icon: string;
}

/**
 * Parameters for minting additional tokens
 * @description Mints new tokens if the token is mintable and caller is the owner
 * @example
 * ```typescript
 * const params: MintTokensParams = {
 *   contract: (hex)"token_contract...",
 *   assetHash: (hex)"abc123...",
 *   mintAmount: 50000,
 *   maxGas: 150000000
 * };
 * ```
 */
export interface MintTokensParams {
  /**
   * Address of the token contract
   * @example (hex)"token_contract..."
   */
  contract: string;
  
  /**
   * Hash identifier of the token to mint
   * @format 64-character hexadecimal string
   * @example (hex)"abc123..."
   */
  assetHash: string;
  
  /**
   * Amount of tokens to mint (with decimals)
   * @description The actual minted amount will be this value adjusted by token decimals
   * @minimum 1
   */
  mintAmount: number;
  
  /**
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;
}

/**
 * Parameters for transferring token ownership
 * @description Transfers ownership rights of a token to a new address
 * @example
 * ```typescript
 * const params: TransferOwnershipParams = {
 *   contract: (hex)"token_contract...",
 *   assetHash: (hex)"abc123...",
 *   ownerAddress: (hex)"new_owner...",
 *   maxGas: 100000000
 * };
 * ```
 */
export interface TransferOwnershipParams {
  /**
   * Address of the token contract
   * @example (hex)"token_contract..."
   */
  contract: string;
  
  /**
   * Hash identifier of the token
   * @format 64-character hexadecimal string
   * @example (hex)"abc123..."
   */
  assetHash: string;
  
  /**
   * Address of the new token owner
   * @description The address that will receive ownership rights (minting, ownership transfer)
   * @example (hex)"new_owner..."
   */
  ownerAddress: string;
  
  /**
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;
}

/**
 * Parameters for renouncing token ownership
 * @description Permanently removes owner privileges from a token, making it immutable
 * @warning This action is irreversible. No one will be able to mint or transfer ownership after renouncement
 * @example
 * ```typescript
 * const params: RenounceOwnershipParams = {
 *   contract: (hex)"token_contract...",
 *   assetHash: (hex)"abc123...",
 *   maxGas: 100000000
 * };
 * ```
 */
export interface RenounceOwnershipParams {
  /**
   * Address of the token contract
   * @example (hex)"token_contract..."
   */
  contract: string;
  
  /**
   * Hash identifier of the token
   * @format 64-character hexadecimal string
   * @description The token that will have its ownership permanently renounced
   * @example (hex)"abc123..."
   */
  assetHash: string;
  
  /**
   * Maximum gas units to allocate for the transaction
   * @default 200000000
   * @minimum 1000000
   */
  maxGas?: number;
}

/**
 * Parameters for deploying a smart contract
 * @description Deploys compiled contract bytecode to the blockchain
 * @example
 * ```typescript
 * const params: DeployContractParams = {
 *   bytecode: (hex)"608060405234801561001057600080fd5b50...",
 *   hasConstructor: true,
 *   maxGas: 500000000
 * };
 * ```
 */
export interface DeployContractParams {
  /**
   * Compiled contract bytecode
   * @description The hexadecimal representation of the compiled smart contract
   * @format Hexadecimal string
   * @example (hex)"608060405234801561001057600080fd5b50..."
   */
  bytecode: string;
  
  /**
   * Whether the contract has a constructor function
   * @description If true, the constructor will be called during deployment
   * @default false
   */
  hasConstructor?: boolean;
  
  /**
   * Maximum gas units to allocate for the deployment
   * @description Contract deployment typically requires more gas than regular transactions
   * @default 200000000
   * @minimum 10000000
   */
  maxGas?: number;
}