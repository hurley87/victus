import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";

/**
 * Client-and-server-safe ERC-20 calldata builders. Kept out of
 * `lib/chain/erc20.ts` (which is `server-only` for RPC reads) so the
 * withdraw and swap submission paths can import pure encoding helpers
 * without pulling in viem's public-client surface.
 */
export function buildErc20TransferCalldata(
  to: Address | string,
  amount: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), amount],
  });
}
