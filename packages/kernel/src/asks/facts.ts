/** The facts some ask kinds carry, owned by the kernel's ask contract so its modules depend on it, not the other way round (#75). */

/** One line of what the person is shown before a download service acts for an applet. */
export interface DownloadQuestionLine {
  readonly label: string;
  readonly value: string;
}

/**
 * What a download service puts to the person before it acts for an applet. Words only:
 * no address, path, credential or raw backend id belongs in a line.
 */
export interface DownloadQuestion {
  /** Which decision this is, so the host can word and rank it. */
  readonly kind: 'add' | 'session' | 'delete';
  readonly title: string;
  readonly lines: readonly DownloadQuestionLine[];
}

/** What the person is asked about before a file leaves for a server. */
export interface UploadDetails {
  readonly filename?: string;
  readonly mimeType: string;
  readonly size: number;
  readonly sha256: string;
  readonly servers: readonly string[];
}
