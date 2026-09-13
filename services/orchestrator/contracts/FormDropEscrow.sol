// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Holds each form's payout pot on-chain and enforces the two invariants that
 * previously lived only in application code:
 *  - a given (formId, responseId) can never be paid out more than once, ever
 *  - a form can never pay out more than was actually funded into it
 * Both checks are now real, on-chain guarantees, independently verifiable by
 * anyone reading contract state — not just something our backend promises.
 *
 * What this deliberately does NOT make trustless: the AI verdict and the
 * World ID uniqueness proof still happen off-chain. `operator` (our
 * backend's key) still decides WHEN to call payout — this contract only
 * enforces WHAT happens once it does.
 */
contract FormDropEscrow {
    address public owner;
    address public operator;

    mapping(bytes32 => uint256) public potBalance;
    mapping(bytes32 => bool) public paid;

    event PotFunded(string formId, address indexed funder, uint256 amount);
    event Paid(string formId, string responseId, address indexed recipient, uint256 amount);
    event Withdrawn(string formId, address indexed to, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _operator) {
        owner = msg.sender;
        operator = _operator;
    }

    function setOperator(address newOperator) external onlyOwner {
        operator = newOperator;
    }

    function fundPot(string calldata formId) external payable {
        require(msg.value > 0, "no value sent");
        potBalance[keccak256(bytes(formId))] += msg.value;
        emit PotFunded(formId, msg.sender, msg.value);
    }

    function payout(
        string calldata formId,
        string calldata responseId,
        address payable recipient,
        uint256 amount
    ) external onlyOperator {
        bytes32 formKey = keccak256(bytes(formId));
        bytes32 payKey = keccak256(abi.encodePacked(formId, responseId));

        require(!paid[payKey], "already paid");
        require(potBalance[formKey] >= amount, "insufficient pot balance");

        paid[payKey] = true;
        potBalance[formKey] -= amount;

        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "transfer failed");

        emit Paid(formId, responseId, recipient, amount);
    }

    function withdrawRemaining(string calldata formId, address payable to) external onlyOperator {
        bytes32 formKey = keccak256(bytes(formId));
        uint256 amount = potBalance[formKey];
        require(amount > 0, "nothing to withdraw");
        potBalance[formKey] = 0;
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "transfer failed");
        emit Withdrawn(formId, to, amount);
    }

    function getPotBalance(string calldata formId) external view returns (uint256) {
        return potBalance[keccak256(bytes(formId))];
    }
}
