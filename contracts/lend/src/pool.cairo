use starknet::ContractAddress;

#[starknet::interface]
trait IClawLendPool<TContractState> {
    fn get_config(self: @TContractState) -> (ContractAddress, ContractAddress, ContractAddress);
    fn set_price_wbtc_usdc(ref self: TContractState, price_e6: u128);
    fn get_price_wbtc_usdc(self: @TContractState) -> u128;

    fn deposit(ref self: TContractState, amount: u256);
    fn withdraw(ref self: TContractState, amount: u256);

    fn borrow(ref self: TContractState, amount: u256);
    fn repay(ref self: TContractState, amount: u256);

    fn collateral_of(self: @TContractState, user: ContractAddress) -> u256;
    fn debt_of(self: @TContractState, user: ContractAddress) -> u256;
}

#[starknet::contract]
mod ClawLendPool {
    use super::IClawLendPool;
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_contract_address;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, Map, StorageMapReadAccess, StorageMapWriteAccess};

    use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};

    // Fixed-point constants
    const LTV_BPS: u128 = 6000; // 60%
    const BPS_DENOM: u128 = 10000;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        collateral_token: ContractAddress, // WBTC
        borrow_token: ContractAddress, // USDC
        // price of 1 WBTC in USDC with 6 decimals (e.g. 43000.00 -> 43000000000)
        price_wbtc_usdc_e6: u128,
        collateral: Map<ContractAddress, u256>,
        debt: Map<ContractAddress, u256>,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        collateral_token: ContractAddress,
        borrow_token: ContractAddress,
        initial_price_e6: u128,
    ) {
        self.owner.write(owner);
        self.collateral_token.write(collateral_token);
        self.borrow_token.write(borrow_token);
        self.price_wbtc_usdc_e6.write(initial_price_e6);
    }

    fn assert_owner(self: @ContractState) {
        let caller = get_caller_address();
        assert(caller == self.owner.read(), 'NOT_OWNER');
    }

    fn max_borrow_usdc_e6(self: @ContractState, user: ContractAddress) -> u256 {
        // collateral is WBTC in 1e8
        let c = self.collateral.read(user);
        let price = self.price_wbtc_usdc_e6.read();

        // value_usdc_e6 = c * price / 1e8
        let value = c * price.into();
        let value = value / 100000000_u256; // 1e8

        let max = value * LTV_BPS.into() / BPS_DENOM.into();
        max
    }

    #[abi(embed_v0)]
    impl ClawLendPoolImpl of IClawLendPool<ContractState> {
        fn get_config(self: @ContractState) -> (ContractAddress, ContractAddress, ContractAddress) {
            (self.owner.read(), self.collateral_token.read(), self.borrow_token.read())
        }

        fn set_price_wbtc_usdc(ref self: ContractState, price_e6: u128) {
            assert_owner(@self);
            self.price_wbtc_usdc_e6.write(price_e6);
        }

        fn get_price_wbtc_usdc(self: @ContractState) -> u128 {
            self.price_wbtc_usdc_e6.read()
        }

        fn deposit(ref self: ContractState, amount: u256) {
            let user = get_caller_address();
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };

            // pull WBTC from user
            let _ = token.transfer_from(user, get_contract_address(), amount);

            let cur = self.collateral.read(user);
            self.collateral.write(user, cur + amount);
        }

        fn withdraw(ref self: ContractState, amount: u256) {
            let user = get_caller_address();
            let cur = self.collateral.read(user);
            assert(cur >= amount, 'INSUFFICIENT_COLLATERAL');

            // check health after withdrawal
            let new_c = cur - amount;
            let d = self.debt.read(user);

            let price = self.price_wbtc_usdc_e6.read();
            let value = new_c * price.into();
            let value = value / 100000000_u256;
            let max = value * LTV_BPS.into() / BPS_DENOM.into();
            assert(d <= max, 'WOULD_UNDERCOLLATERALIZE');

            self.collateral.write(user, new_c);

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let _ = token.transfer(user, amount);
        }

        fn borrow(ref self: ContractState, amount: u256) {
            let user = get_caller_address();
            let d = self.debt.read(user);
            let max = max_borrow_usdc_e6(@self, user);
            assert(d + amount <= max, 'BORROW_TOO_LARGE');

            // send USDC from pool reserves
            let token = IERC20Dispatcher { contract_address: self.borrow_token.read() };
            let _ = token.transfer(user, amount);

            self.debt.write(user, d + amount);
        }

        fn repay(ref self: ContractState, amount: u256) {
            let user = get_caller_address();
            let d = self.debt.read(user);
            assert(d > 0_u256, 'NO_DEBT');
            let pay = if amount > d { d } else { amount };

            let token = IERC20Dispatcher { contract_address: self.borrow_token.read() };
            let _ = token.transfer_from(user, get_contract_address(), pay);

            self.debt.write(user, d - pay);
        }

        fn collateral_of(self: @ContractState, user: ContractAddress) -> u256 {
            self.collateral.read(user)
        }

        fn debt_of(self: @ContractState, user: ContractAddress) -> u256 {
            self.debt.read(user)
        }
    }
}
