"""
KINDpos ESC/POS Network Printer Adapter
========================================
Nice. Dependable. Yours.

Real network printer adapter for Epson, Star, and compatible ESC/POS
thermal and impact printers connected via TCP socket (usually port 9100).

Connects to physical hardware via asyncio TCP socket.
Implements the full BasePrinter contract for real hardware integration.

File location: backend/app/core/adapters/escpos_network.py
"""

import asyncio
import logging
from typing import Optional
from datetime import datetime

from .base_printer import (
    BasePrinter,
    PrinterConfig,
    PrinterType,
    PrinterStatus,
    PrintJob,
    PrintJobType,
    PrintResult,
    CutType,
)
from ...printing.escpos_formatter import ESCPOSFormatter
from ...printing.templates.kitchen_ticket import KitchenTicketTemplate
from ...printing.templates.guest_receipt import GuestReceiptTemplate

logger = logging.getLogger("kindpos.printer.escpos_network")


class EscPosNetworkAdapter(BasePrinter):
    """
    Real ESC/POS network printer adapter.

    Connects to physical printers via TCP socket (usually port 9100).
    Supports thermal receipt printers and impact kitchen printers.
    All operations are async and non-blocking.

    Features:
        - TCP connection with configurable timeout
        - Paper cut (full, partial, or tear)
        - Cash drawer kick support
        - Printer reboot via ESC @ command
        - Comprehensive error handling and logging
    """

    def __init__(
        self,
        printer_id: str,
        name: str,
        printer_type: PrinterType,
        role: str,
        ip_address: str,
        port: int = 9100,
        chars_per_line: int = 48,
        has_cutter: bool = True,
        has_drawer: bool = False,
        connect_timeout: float = 3.0,
        print_timeout: float = 10.0,
        location_tag: Optional[str] = None,
        fallback_printer_id: Optional[str] = None,
    ):
        """
        Initialize the ESC/POS network printer adapter.

        Args:
            printer_id: Unique identifier for this printer
            name: Operator-assigned display name
            printer_type: PrinterType.THERMAL or PrinterType.IMPACT
            role: Assigned role (e.g., "receipt", "kitchen")
            ip_address: IP address of the printer
            port: TCP port (default 9100 for ESC/POS)
            chars_per_line: Character width (48 for 80mm thermal, 33 for impact)
            has_cutter: Whether printer supports auto-cut
            has_drawer: Whether printer has cash drawer connection
            connect_timeout: TCP connection timeout in seconds
            print_timeout: Print job timeout in seconds
            location_tag: Optional location description
            fallback_printer_id: Optional backup printer ID
        """
        # Build PrinterConfig
        config = PrinterConfig(
            printer_id=printer_id,
            name=name,
            printer_type=printer_type,
            role=role,
            connection_string=f"{ip_address}:{port}",
            location_tag=location_tag,
            fallback_printer_id=fallback_printer_id,
        )

        super().__init__(config)

        self.ip_address = ip_address
        self.port = port
        self.chars_per_line = chars_per_line
        self.has_cutter = has_cutter
        self.has_drawer = has_drawer
        self.connect_timeout = connect_timeout
        self.print_timeout = print_timeout

        # TCP socket connection
        self._writer: Optional[asyncio.StreamWriter] = None
        self._reader: Optional[asyncio.StreamReader] = None

        logger.info(
            f"[ESCPOS NET] Initialized: '{name}' "
            f"(id={printer_id}, type={printer_type.value}, "
            f"address={ip_address}:{port}, role={role})"
        )

    # -----------------------------------------------------------------
    # Connection Management
    # -----------------------------------------------------------------

    async def connect(self) -> bool:
        """
        Establish TCP connection to the printer.

        Returns True if connection was successful.
        Sets status to ONLINE on success, OFFLINE on failure.
        """
        try:
            logger.info(
                f"[ESCPOS NET] '{self.name}' — Connecting to {self.ip_address}:{self.port}..."
            )

            # Open TCP connection with timeout
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.ip_address, self.port),
                timeout=self.connect_timeout,
            )

            self._connected = True
            self._status = PrinterStatus.ONLINE
            logger.info(
                f"[ESCPOS NET] '{self.name}' — Connected successfully"
            )
            return True

        except asyncio.TimeoutError:
            self._connected = False
            self._status = PrinterStatus.OFFLINE
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Connection timeout "
                f"({self.connect_timeout}s) to {self.ip_address}:{self.port}"
            )
            return False

        except ConnectionRefusedError:
            self._connected = False
            self._status = PrinterStatus.OFFLINE
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Connection refused "
                f"by {self.ip_address}:{self.port}"
            )
            return False

        except OSError as e:
            self._connected = False
            self._status = PrinterStatus.OFFLINE
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Connection error: {e}"
            )
            return False

        except Exception as e:
            self._connected = False
            self._status = PrinterStatus.OFFLINE
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Unexpected error connecting: {e}"
            )
            return False

    async def disconnect(self) -> bool:
        """
        Close the TCP connection to the printer.

        Returns True if disconnection was clean.
        Sets status to OFFLINE.
        """
        try:
            if self._writer is not None:
                self._writer.close()
                # Wait for the writer to finish closing
                try:
                    await asyncio.wait_for(self._writer.wait_closed(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass

            self._reader = None
            self._writer = None
            self._connected = False
            self._status = PrinterStatus.OFFLINE

            logger.info(f"[ESCPOS NET] '{self.name}' — Disconnected")
            return True

        except Exception as e:
            logger.error(f"[ESCPOS NET] '{self.name}' — Error disconnecting: {e}")
            self._reader = None
            self._writer = None
            self._connected = False
            self._status = PrinterStatus.OFFLINE
            return False

    def is_connected(self) -> bool:
        """
        Check if the TCP connection is still alive.

        Returns True only if status is ONLINE and socket is open.
        """
        if self._status != PrinterStatus.ONLINE:
            return False
        if self._writer is None or self._reader is None:
            return False
        if self._writer.is_closing():
            return False
        return True

    # -----------------------------------------------------------------
    # Core Operations
    # -----------------------------------------------------------------

    async def print_job(self, job: PrintJob) -> PrintResult:
        """
        Send a print job to the printer via ESC/POS protocol.

        Connects if needed, formats job commands, sends over TCP.
        Returns PrintResult with success/failure details.
        Never raises exceptions — always returns PrintResult.
        """
        try:
            # Check connection, attempt reconnect once if offline
            if not self.is_connected():
                logger.warning(
                    f"[ESCPOS NET] '{self.name}' — Not connected, "
                    f"attempting reconnect..."
                )
                reconnected = await self.connect()
                if not reconnected:
                    logger.error(
                        f"[ESCPOS NET] '{self.name}' — Reconnect failed, "
                        f"job={job.job_id[:8]}..."
                    )
                    return PrintResult(
                        success=False,
                        job_id=job.job_id,
                        printer_id=self.printer_id,
                        message="Printer offline",
                        error_code="printer_offline",
                    )

            # Render the PrintJob into an ESC/POS command list, then format.
            # Mirrors PrintDispatcher._render(): template.render(context) → list of
            # command dicts → ESCPOSFormatter.format(commands) → raw bytes.
            if job.job_type == PrintJobType.KITCHEN_TICKET:
                template = KitchenTicketTemplate(chars_per_line=self.chars_per_line)
            elif job.job_type == PrintJobType.RECEIPT:
                template = GuestReceiptTemplate(chars_per_line=self.chars_per_line)
            elif job.job_type == PrintJobType.REPRINT:
                # Reprints don't carry the original document class on the enum;
                # route by target_role so the document looks like its original.
                role = (job.target_role or "").lower()
                if role == "receipt":
                    template = GuestReceiptTemplate(chars_per_line=self.chars_per_line)
                elif role in ("kitchen", "bar"):
                    template = KitchenTicketTemplate(chars_per_line=self.chars_per_line)
                else:
                    raise ValueError(
                        f"Cannot pick template for REPRINT job {job.job_id}: "
                        f"unrecognized target_role {job.target_role!r}"
                    )
            else:
                raise ValueError(
                    f"Unsupported PrintJob.job_type for ESC/POS network adapter: "
                    f"{job.job_type}"
                )

            # Build the template context. `metadata` carries the rich
            # template fields (check_number, table, items, etc.); the
            # PrintJobContent line buckets and PrintJob identity fields
            # are added as fallbacks so templates that read them still work.
            context: dict = dict(job.content.metadata or {})
            context.setdefault('header_lines', list(job.content.header_lines))
            context.setdefault('body_lines', list(job.content.body_lines))
            context.setdefault('footer_lines', list(job.content.footer_lines))
            context.setdefault('order_id', job.order_id)
            context.setdefault('server_name', job.server_name)
            context.setdefault('terminal_id', job.terminal_id)
            context.setdefault('order_context', job.order_context.value)
            if job.is_reprint:
                context.setdefault('is_reprint', True)
                context.setdefault('ticket_type', 'REPRINT')
                if job.source_job_id:
                    context.setdefault('source_job_id', job.source_job_id)

            commands = template.render(context)

            formatter = ESCPOSFormatter(
                paper_width=80,
                chars_per_line=self.chars_per_line,
            )
            data = formatter.format(commands)

            # Send over TCP with timeout
            await asyncio.wait_for(
                self._send_bytes(data),
                timeout=self.print_timeout,
            )

            logger.info(
                f"[ESCPOS NET] '{self.name}' — Print SUCCESS "
                f"(job_id={job.job_id[:8]}..., order={job.order_id})"
            )

            return PrintResult(
                success=True,
                job_id=job.job_id,
                printer_id=self.printer_id,
                message="Printed successfully",
            )

        except asyncio.TimeoutError:
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Print timeout "
                f"(job_id={job.job_id[:8]}..., timeout={self.print_timeout}s)"
            )
            self._connected = False
            self._status = PrinterStatus.OFFLINE
            return PrintResult(
                success=False,
                job_id=job.job_id,
                printer_id=self.printer_id,
                message="Print timeout",
                error_code="print_timeout",
            )

        except Exception as e:
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Print failed: {e} "
                f"(job_id={job.job_id[:8]}...)"
            )
            self._connected = False
            self._status = PrinterStatus.OFFLINE
            return PrintResult(
                success=False,
                job_id=job.job_id,
                printer_id=self.printer_id,
                message=f"Print failed: {str(e)}",
                error_code="print_error",
            )

    async def check_status(self) -> PrinterStatus:
        """
        Probe the printer's status via lightweight TCP connection.

        Attempts a non-blocking connection to check if printer responds.
        Does not affect in-progress print jobs.
        Returns ONLINE if printer responds, OFFLINE otherwise.
        """
        try:
            # Attempt lightweight connection probe
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.ip_address, self.port),
                timeout=self.connect_timeout,
            )

            # Close the probe connection immediately
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=1.0)
            except asyncio.TimeoutError:
                pass

            self._status = PrinterStatus.ONLINE
            logger.debug(f"[ESCPOS NET] '{self.name}' — Status: ONLINE")
            return self._status

        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            self._status = PrinterStatus.OFFLINE
            logger.debug(f"[ESCPOS NET] '{self.name}' — Status: OFFLINE")
            return self._status

        except Exception as e:
            logger.debug(f"[ESCPOS NET] '{self.name}' — Status check error: {e}")
            self._status = PrinterStatus.OFFLINE
            return self._status

    # -----------------------------------------------------------------
    # Paper Operations
    # -----------------------------------------------------------------

    async def cut_paper(self, cut_type: Optional[CutType] = None) -> bool:
        """
        Execute a paper cut command.

        Supports FULL cut (GS V 0) and PARTIAL cut (GS V 1).
        TEAR type returns False (no hardware support for this printer).

        Args:
            cut_type: CutType enum (FULL, PARTIAL, or TEAR)

        Returns True if cut command was sent successfully.
        """
        if not self.has_cutter:
            logger.debug(
                f"[ESCPOS NET] '{self.name}' — Cut requested but no cutter"
            )
            return False

        actual_cut = cut_type or self._config.cut_type

        if actual_cut == CutType.TEAR:
            # No auto-cut hardware support
            return False

        try:
            if actual_cut == CutType.FULL:
                data = bytes([0x1D, 0x56, 0x00])  # GS V 0
            else:  # PARTIAL
                data = bytes([0x1D, 0x56, 0x01])  # GS V 1

            await asyncio.wait_for(
                self._send_bytes(data),
                timeout=self.print_timeout,
            )

            logger.info(
                f"[ESCPOS NET] '{self.name}' — Paper cut: {actual_cut.value}"
            )
            return True

        except Exception as e:
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Cut failed: {e}"
            )
            return False

    # -----------------------------------------------------------------
    # Cash Drawer
    # -----------------------------------------------------------------

    async def open_drawer(self) -> bool:
        """
        Send cash drawer kick command.

        Uses ESC p (0x1B 0x70 0x00 0x19 0xFA).
        Only works if has_drawer is True.

        Returns True if drawer kick command was sent successfully.
        """
        if not self.has_drawer:
            logger.debug(
                f"[ESCPOS NET] '{self.name}' — Drawer kick requested but no drawer"
            )
            return False

        try:
            # ESC p n1 n2 — Drawer kick command
            data = bytes([0x1B, 0x70, 0x00, 0x19, 0xFA])

            await asyncio.wait_for(
                self._send_bytes(data),
                timeout=self.print_timeout,
            )

            logger.info(f"[ESCPOS NET] '{self.name}' — Cash drawer opened")
            return True

        except Exception as e:
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Drawer kick failed: {e}"
            )
            return False

    # -----------------------------------------------------------------
    # Maintenance
    # -----------------------------------------------------------------

    async def reboot(self) -> bool:
        """
        Send printer initialization/reboot command.

        Uses ESC @ (0x1B 0x40) to reset printer state.
        Does not perform a power cycle.

        Returns True if reboot command was sent successfully.
        """
        try:
            # ESC @ — Initialize/reboot command
            data = bytes([0x1B, 0x40])

            await asyncio.wait_for(
                self._send_bytes(data),
                timeout=self.print_timeout,
            )

            logger.info(f"[ESCPOS NET] '{self.name}' — Reboot command sent")
            return True

        except Exception as e:
            logger.error(
                f"[ESCPOS NET] '{self.name}' — Reboot failed: {e}"
            )
            return False

    # -----------------------------------------------------------------
    # Internal — Socket Operations
    # -----------------------------------------------------------------

    async def _send_bytes(self, data: bytes) -> None:
        """
        Send raw bytes over TCP socket.

        Raises exception on failure (handled by caller).
        """
        if self._writer is None:
            raise RuntimeError("Not connected")

        self._writer.write(data)
        await self._writer.drain()


# =====================================================================
# FACTORY FUNCTIONS — Convenience constructors
# =====================================================================


def make_thermal_printer(
    printer_id: str,
    name: str,
    ip: str,
    port: int = 9100,
    chars_per_line: int = 48,
    has_drawer: bool = False,
    **kwargs,
) -> EscPosNetworkAdapter:
    """
    Create a thermal (receipt) printer adapter.

    Configured for 80mm thermal receipt printers with auto-cut.

    Args:
        printer_id: Unique identifier
        name: Display name
        ip: IP address
        port: TCP port (default 9100)
        chars_per_line: Character width (default 48)
        has_drawer: Whether to support cash drawer (default False)
        **kwargs: Additional arguments passed to EscPosNetworkAdapter

    Returns:
        EscPosNetworkAdapter configured for thermal receipt printing
    """
    return EscPosNetworkAdapter(
        printer_id=printer_id,
        name=name,
        printer_type=PrinterType.THERMAL,
        role="receipt",
        ip_address=ip,
        port=port,
        chars_per_line=chars_per_line,
        has_cutter=True,
        has_drawer=has_drawer,
        **kwargs,
    )


def make_kitchen_printer(
    printer_id: str,
    name: str,
    ip: str,
    port: int = 9100,
    chars_per_line: int = 33,
    is_impact: bool = True,
    **kwargs,
) -> EscPosNetworkAdapter:
    """
    Create a kitchen (impact or thermal) printer adapter.

    Configured for kitchen ticket printing.
    Impact printers (dot matrix) don't have auto-cut.
    Thermal kitchen printers have auto-cut.

    Args:
        printer_id: Unique identifier
        name: Display name
        ip: IP address
        port: TCP port (default 9100)
        chars_per_line: Character width (default 33 for impact)
        is_impact: True for dot matrix, False for thermal (default True)
        **kwargs: Additional arguments passed to EscPosNetworkAdapter

    Returns:
        EscPosNetworkAdapter configured for kitchen printing
    """
    return EscPosNetworkAdapter(
        printer_id=printer_id,
        name=name,
        printer_type=PrinterType.IMPACT if is_impact else PrinterType.THERMAL,
        role="kitchen",
        ip_address=ip,
        port=port,
        chars_per_line=chars_per_line,
        has_cutter=not is_impact,  # Impact printers don't have auto-cut
        has_drawer=False,  # Kitchen printers never have drawer
        **kwargs,
    )
