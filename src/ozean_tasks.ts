import { ethers } from 'ethers';
import { Request, Response } from 'express';

// Interfaces for type safety
export interface ChainActivityResult {
  bridging: boolean;
  staking: boolean;
  tokenWrapping: boolean;
}

export class ChainActivityVerifier {
  private sepoliaProvider: ethers.Provider;
  private ozeanProvider: ethers.Provider;

  // Contract addresses and ABIs (replace with actual values)
  private bridgeContractAddress: string;
  private stakingContractAddress: string;
  private tokenContractAddress: string;

  private bridgeContractABI: any[];
  private stakingContractABI: any[];
  private tokenContractABI: any[];

  constructor() {
    // Initialize providers
    this.sepoliaProvider = new ethers.JsonRpcProvider(
      process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2'
    );

    this.ozeanProvider = new ethers.JsonRpcProvider(
      process.env.OZEAN_RPC_URL || 'https://ozean-testnet.rpc.caldera.xyz/http'
    );

    // Load contract addresses from environment
    this.bridgeContractAddress = process.env.BRIDGE_CONTRACT_ADDRESS || '0x084c27a0be5df26ed47f00678027a6e76b14a0b4';
    this.stakingContractAddress = process.env.STAKING_CONTRACT_ADDRESS || '0x1Ce4888a6dED8d6aE5F5D9ca1CABc758c680950b';
    this.tokenContractAddress = process.env.TOKEN_CONTRACT_ADDRESS || '0x2f6807b76c426527C3a5C442E8697f12C554195b';

    // Load ABIs (in a real scenario, these would be imported from JSON files)
    this.bridgeContractABI = [{
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "_stablecoin",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "_amount",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "_to",
          "type": "address"
        }
      ],
      "name": "BridgeDeposit",
      "type": "event"
    }];

    this.stakingContractABI = [
      'function sharesOf(address user) view returns (uint256)',
    ];

    this.tokenContractABI = [{
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "from",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "to",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "value",
          "type": "uint256"
        }
      ],
      "name": "Transfer",
      "type": "event"
    }];
  }

  public async verifyBridgeActivity(userAddress: string): Promise<boolean> {
    try {
      const bridgeContract = new ethers.Contract(
        this.bridgeContractAddress, 
        this.bridgeContractABI, 
        this.sepoliaProvider
      );

      // just checking for USDC stablecoin.. same can be done for USDT or others
      const filterUSDC = bridgeContract.filters.BridgeDeposit('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', null , userAddress);
      const filterUSDT = bridgeContract.filters.BridgeDeposit('0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0', null , userAddress);
      const filterUSDTAlt = bridgeContract.filters.BridgeDeposit('0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', null , userAddress);
      const filterDAI = bridgeContract.filters.BridgeDeposit('0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357', null , userAddress);
  
      const events = await Promise.all([
        bridgeContract.queryFilter(filterUSDC),
        bridgeContract.queryFilter(filterUSDT),
        bridgeContract.queryFilter(filterUSDTAlt),
        bridgeContract.queryFilter(filterDAI)
      ])

      return events.map( e=> e.length > 0).some( x => x);
    } catch (error) {
      console.error('Bridge activity check failed:', error);
      return false;
    }
  }

  public async verifyStakingActivity(userAddress: string): Promise<boolean> {
    try {
      const stakingContract = new ethers.Contract(
        this.stakingContractAddress, 
        this.stakingContractABI, 
        this.ozeanProvider
      );

      // Check staked balance
      const stakedBalance = await stakingContract.sharesOf(userAddress);
      return BigInt(stakedBalance.toString()) > BigInt(0);
    } catch (error) {
      console.error('Staking activity check failed:', error);
      return false;
    }
  }

  public async verifyTokenWrappingActivity(userAddress: string): Promise<boolean> {
    try {
      const tokenContract = new ethers.Contract(
        this.tokenContractAddress, 
        this.tokenContractABI, 
        this.ozeanProvider
      );

      // Check wrap events
      const wrapFilter = tokenContract.filters.Transfer('0x0000000000000000000000000000000000000000', userAddress);
      // const unwrapFilter = tokenContract.filters.Transfer(userAddress, '0x0000000000000000000000000000000000000000');

      const wrapEvents = await tokenContract.queryFilter(wrapFilter);
      // const unwrapEvents = await tokenContract.queryFilter(unwrapFilter);

      return wrapEvents.length > 0;// || unwrapEvents.length > 0;
    } catch (error) {
      console.error('Token wrapping activity check failed:', error);
      return false;
    }
  }

  public async checkUserActivities(userAddress: string): Promise<ChainActivityResult> {
    // Validate Ethereum address
    if (!ethers.isAddress(userAddress)) {
      throw new Error('Invalid Ethereum address');
    }

    const [
      bridging,
      staking,
      tokenWrapping
    ] = await Promise.all([
      this.verifyBridgeActivity(userAddress),
      this.verifyStakingActivity(userAddress),
      this.verifyTokenWrappingActivity(userAddress)
    ]);

    return {
      bridging,
      staking,
      tokenWrapping
    };
  }

  public async isUserEligibleForReward(userAddress: string): Promise<boolean> {
    const activities = await this.checkUserActivities(userAddress);
    return Object.values(activities).every(activity => activity === true);
  }
}


export const ozeanBridgeHandler = async (req: Request, res: Response) => {
  try {
    // Extract user address from query or body
    const userAddress = req.query.address as string || req.body.address || '0x73cb4Cf464Ba30bBB369Ce7AC58C0e1B1920EAF6';

    // Initialize verifier
    const verifier = new ChainActivityVerifier();

    // Check user activities
    const bridging = await verifier.verifyBridgeActivity(userAddress);

    let response = {
      "data": {
          "result":  bridging
      }
    }
    res.send(response)
  } catch (error) {
    console.error('Error processing request:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to process request', 
      details: errorMessage 
    });
  }
};

export const ozeanStakeHandler = async (req: Request, res: Response) => {
  try {
    // Extract user address from query or body
    const userAddress = req.query.address as string || req.body.address || '0x73cb4Cf464Ba30bBB369Ce7AC58C0e1B1920EAF6';

    // Initialize verifier
    const verifier = new ChainActivityVerifier();

    // Check user activities
    const staking = await verifier.verifyStakingActivity(userAddress);

    let response = {
      "data": {
          "result":  staking
      }
    }
    res.send(response)
  } catch (error) {
    console.error('Error processing request:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to process request', 
      details: errorMessage 
    });
  }
};

export const ozeanWrapHandler = async (req: Request, res: Response) => {
  try {
    // Extract user address from query or body
    const userAddress = req.query.address as string || req.body.address || '0x73cb4Cf464Ba30bBB369Ce7AC58C0e1B1920EAF6';

    // Initialize verifier
    const verifier = new ChainActivityVerifier();

    // Check user activities
    const wrapUnwrap = await verifier.verifyTokenWrappingActivity(userAddress);

    let response = {
      "data": {
          "result": wrapUnwrap
      }
    }
    res.send(response)
  } catch (error) {
    console.error('Error processing request:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to process request', 
      details: errorMessage 
    });
  }
};
