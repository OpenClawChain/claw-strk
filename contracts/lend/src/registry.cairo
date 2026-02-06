use starknet::ContractAddress;

#[starknet::interface]
trait IClawLendRegistry<TContractState> {
    fn add_pool(ref self: TContractState, pool: ContractAddress);
    fn pool_count(self: @TContractState) -> u32;
    fn pool_at(self: @TContractState, index: u32) -> ContractAddress;
}

#[starknet::contract]
mod ClawLendRegistry {
    use super::IClawLendRegistry;
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, Map, StorageMapReadAccess, StorageMapWriteAccess};

    #[storage]
    struct Storage {
        owner: ContractAddress,
        count: u32,
        pools: Map<u32, ContractAddress>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.count.write(0);
    }

    #[abi(embed_v0)]
    impl ClawLendRegistryImpl of IClawLendRegistry<ContractState> {
        fn add_pool(ref self: ContractState, pool: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), 'NOT_OWNER');

            let i = self.count.read();
            self.pools.write(i, pool);
            self.count.write(i + 1);
        }

        fn pool_count(self: @ContractState) -> u32 {
            self.count.read()
        }

        fn pool_at(self: @ContractState, index: u32) -> ContractAddress {
            self.pools.read(index)
        }
    }
}
