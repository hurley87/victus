import pinataSDK from '@pinata/sdk';

// Initialize Pinata client
const pinata = new pinataSDK({ pinataJWTKey: process.env.PINATA_JWT_KEY });

/**
 * IPFS service for handling metadata storage
 */
export const ipfsService = {
  /**
   * Pins metadata to IPFS and returns the URI
   *
   * @param name - The name of the content
   * @param description - The description of the content
   * @param image - The image URL
   * @returns The IPFS URI pointing to the pinned metadata
   */
  async pinMetadata(
    name: string,
    description: string,
    image: string
  ): Promise<string> {
    try {
      const metadata = { name, description, image };
      const pinataRes = await pinata.pinJSONToIPFS(metadata);

      return `https://amber-late-bug-27.mypinata.cloud/ipfs/${pinataRes.IpfsHash}`;
    } catch (error) {
      console.error('Error pinning to IPFS:', error);
      throw new Error(
        `Failed to pin metadata to IPFS: ${(error as Error).message}`
      );
    }
  },
};
