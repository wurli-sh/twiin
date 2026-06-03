// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Minimal UniswapV2Router02 surface. Used as the onchain.execute target in demos.
// Deployed and pre-funded by TwiinFactory (no live DEX on Somnia testnet).
// Rate: 1 STT = MOCK_RATE tokens. Liquidity is synthetic (minted, not locked).
contract MockUniswapV2Router02 {
    uint256 public constant MOCK_RATE = 1000; // 1 STT = 1000 mUSDC (6-decimal token)

    address public immutable mUSDC;

    event Swap(address indexed sender, uint256 amountIn, uint256 amountOut, address indexed to);

    constructor(address _mUSDC) {
        mUSDC = _mUSDC;
    }

    // Seed initial liquidity (called by TwiinFactory at deploy).
    function addLiquidity(
        address /*tokenA*/,
        address /*tokenB*/,
        uint256 /*amountADesired*/,
        uint256 /*amountBDesired*/,
        uint256 /*amountAMin*/,
        uint256 /*amountBMin*/,
        address /*to*/,
        uint256 /*deadline*/
    ) external payable returns (uint256, uint256, uint256) {
        // Accept the STT sent with this call as liquidity reserve.
        return (msg.value, 0, 0);
    }

    // STT → mUSDC
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "expired");
        require(path.length >= 2, "bad path");
        uint256 out = (msg.value * MOCK_RATE) / 1e12; // STT(18d) → mUSDC(6d)
        require(out >= amountOutMin, "slippage");
        require(IERC20(mUSDC).transfer(to, out), "transfer failed");
        emit Swap(msg.sender, msg.value, out, to);
        amounts = new uint256[](2);
        amounts[0] = msg.value;
        amounts[1] = out;
    }

    // mUSDC → STT
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "expired");
        require(path.length >= 2, "bad path");
        require(IERC20(mUSDC).transferFrom(msg.sender, address(this), amountIn), "transfer failed");
        uint256 out = (amountIn * 1e12) / MOCK_RATE; // mUSDC(6d) → STT(18d)
        require(out >= amountOutMin, "slippage");
        require(address(this).balance >= out, "no liquidity");
        (bool ok, ) = to.call{value: out}("");
        require(ok, "eth transfer failed");
        emit Swap(msg.sender, amountIn, out, to);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }

    receive() external payable {}
}
